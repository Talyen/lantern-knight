import { PropContactShadows } from './contact-shadows';
import { cleanupAll, cleanupAfterFailure } from '../assets/cleanup';
import { sceneFixtures } from '../content/scenery-presets';
import type { PreparedRegistration } from '../assets/registration';
import * as T from 'three';
import { ActorSprite, setCutoutOpacity } from './sprite';
import { graveyardGroundMaterial } from './graveyard-ground';
import { SceneryReveals } from './scenery-reveals';
import { resolveClip, type Clip } from '../assets/schema';
import type { AssetPack } from '../assets/loader';
import { type WorldVisualDefinition, type ArtPlacement } from '../content/world-visuals';
import { heightAt, type AreaDefinition } from '../content/world';
import { clipDuration, frameAt } from '../core/animation';
import type { SimulationView } from '../core/simulation-view';
import type { GroundOcclusion } from './ground-occlusion';

export class InkRoom {
  private closed = false;
  readonly sprites: ActorSprite[] = [];
  readonly effects = new Map<string, ActorSprite>();
  readonly fades: ActorSprite[] = [];
  readonly sceneryReveal: SceneryReveals;
  playing = true;
  private animated: { sprite: ActorSprite; placement: ArtPlacement; ground?: boolean }[] = [];
  private occluded = new Map<ActorSprite, ArtPlacement>();
  replay() {
    for (const { sprite } of this.animated) sprite.animator.start(sprite.animator.clip);
  }
  constructor(
    readonly area: AreaDefinition,
    private packs: ReadonlyMap<string, AssetPack>,
    private room: T.Group,
    private camera: T.OrthographicCamera,
    shadowTexture: T.Texture | undefined,
    readonly registration: PreparedRegistration,
    readonly art: WorldVisualDefinition,
  ) {
    this.sceneryReveal = new SceneryReveals(area, registration.coverage);
    try {
      if (shadowTexture) {
        const drops = [...(area.interactables ?? []), ...area.spawns].reduce(
          (sum, source) => sum + (source.rewards?.length ?? 0),
          0,
        );
        this.contactShadows = new PropContactShadows(shadowTexture, art.props.length + drops);
        this.room.add(this.contactShadows.mesh);
      }
    } catch (error) {
      // A throwing constructor never transfers its resources to RoomPresentation.
      cleanupAfterFailure(error, () => this.dispose());
    }
  }

  private sprite(
    id: string,
    asset: string,
    clip: string,
    heading: ArtPlacement['heading'] = 'd45',
  ) {
    if (this.closed) throw new Error('scenery disposed');
    const p = this.packs.get(asset);
    if (!p) throw new Error(`room art not acquired: ${asset}`);
    const s = new ActorSprite(id, p.manifest, p.textures, resolveClip(p.manifest, clip, heading));
    this.sprites.push(s);
    this.room.add(s.mesh);
    return s;
  }
  floorMaterial() {
    if (this.closed) throw new Error('scenery disposed');
    if (this.art.editorFloor) {
      const f = this.art.editorFloor,
        pack = this.packs.get(f.asset)!,
        clip = resolveClip(pack.manifest, f.clip, 'd45'),
        frame = pack.manifest.frames.find((f) => f.id === clip.frames[0])!;
      const map = pack.textures.get(frame.page)!.clone();
      map.wrapS = map.wrapT = f.layout === 'artwork' ? T.ClampToEdgeWrapping : T.RepeatWrapping;
      map.needsUpdate = true;
      this.owned.push(map);
      const material = new T.MeshBasicMaterial({ map, depthWrite: false, toneMapped: false }),
        page = pack.manifest.pages.find((p) => p.id === frame.page)!;
      const [x, y, w, h] = frame.rect;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.editorFloorRect = {
          value: new T.Vector4(
            x / page.width,
            1 - (y + h) / page.height,
            w / page.width,
            h / page.height,
          ),
        };
        shader.fragmentShader = 'uniform vec4 editorFloorRect;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          f.layout === 'artwork'
            ? 'diffuseColor *= texture2D(map,editorFloorRect.xy+clamp(vMapUv,0.0,1.0)*editorFloorRect.zw);'
            : 'diffuseColor *= texture2D(map,editorFloorRect.xy+fract(vMapUv)*editorFloorRect.zw);',
        );
      };
      material.customProgramCacheKey = () =>
        'editor-floor:' + pack.manifest.hash + ':' + f.clip + ':' + (f.layout ?? 'repeat');
      return material;
    }
    return graveyardGroundMaterial(this.packs, this.art);
  }
  private owned: { dispose: () => void }[] = [];
  readonly contactShadows: PropContactShadows | undefined;
  private ground(p: ArtPlacement, asset = p.asset) {
    const s = this.sprite(p.id, asset, p.clip, p.heading);
    s.material.color.set(p.tint ?? 0xffffff);
    setCutoutOpacity(s.material, p.opacity ?? 1);
    this.poseGround(s, p);
    s.mesh.renderOrder = -1.9;
    s.mesh.userData.id = p.id;
    if (s.animator.clip.frames.length > 1)
      this.animated.push({ sprite: s, placement: p, ground: true });
    return s;
  }
  private poseGround(s: ActorSprite, p: ArtPlacement) {
    const scale = p.scale ?? 1,
      angle = p.rotation ?? 0;
    s.showAnimation(new T.Vector3(p.x, heightAt(this.area, p.x, p.z) + 0.018, p.z), this.camera);
    s.mesh.scale.set(scale * (p.mirror ? -1 : 1), scale, scale);
    s.mesh.rotateZ(angle);
    const vertices = s.geometry.getAttribute('position'),
      c = Math.cos(angle),
      sn = Math.sin(angle);
    for (let i = 0; i < vertices.count; i++) {
      const lx = vertices.getX(i) * scale * (p.mirror ? -1 : 1),
        ly = vertices.getY(i) * scale,
        x = p.x + lx * c - ly * sn,
        z = p.z - lx * sn - ly * c;
      vertices.setZ(i, (heightAt(this.area, x, z) - heightAt(this.area, p.x, p.z)) / scale);
    }
    vertices.needsUpdate = true;
    s.geometry.computeBoundingSphere();
  }
  build() {
    if (this.closed) throw new Error('scenery disposed');
    const art = this.art;
    for (const p of art.props) this.place(p);
    for (const p of art.decals) this.ground(p);
  }
  private place(p: ArtPlacement) {
    const s = this.sprite(p.id, p.asset, p.clip, p.heading),
      scale = p.scale ?? 1;
    this.occluded.set(s, p);
    s.show(
      s.animator.frame,
      new T.Vector3(p.x, heightAt(this.area, p.x, p.z) + (p.y ?? 0), p.z),
      this.camera,
    );
    s.mesh.scale.set(scale * (p.mirror ? -1 : 1), scale, scale);
    if (s.animator.clip.frames.length > 1) this.animated.push({ sprite: s, placement: p });
    if (s.manifest.asset.type === 'effect') {
      s.mesh.renderOrder =
        s.manifest.asset.layer === 'below-actor'
          ? -0.5
          : s.manifest.asset.layer === 'overlay'
            ? 1
            : 0;
      s.mesh.userData.emissive = !p.fixture;
    }
    if (p.emissive !== undefined) s.mesh.userData.emissive = p.emissive;
    setCutoutOpacity(s.material, p.opacity ?? 1);
    if (p.tint !== undefined) {
      s.material.color.set(p.tint);
      s.edgeMaterial?.color.copy(s.material.color);
    }
    if (p.rotation) s.mesh.rotateZ(p.rotation);
    if (p.fade) {
      this.fades.push(s);
      this.sceneryReveal.add(s);
    }
    const fixture = sceneFixtures(this.art).find((f) => f.prop === p.id);
    if (fixture?.flame) {
      const settings = fixture.flame,
        emission = this.sprite(fixture.id, settings.asset, settings.clip);
      emission.mesh.userData.emissive = true;
      emission.mesh.userData.decorative = settings.decorative;
      this.occluded.set(emission, p);
    }
    this.contactShadows?.add(p, s, this.area);
  }
  private effect(id: string, asset: string, clip: string, foot?: { x: number; z: number }) {
    let s = this.effects.get(id);
    if (!s) {
      s = this.sprite(id, asset, clip);
      s.mesh.renderOrder = -0.5;
      this.effects.set(id, s);
      if (foot && id.startsWith('drop-'))
        this.contactShadows?.add(
          { id, asset, clip, ...foot, scale: 0.28, purpose: 'Dropped item' },
          s,
          this.area,
        );
    }
    return s;
  }
  private sample(s: ActorSprite, clip: Clip, time: number, foot: T.Vector3) {
    s.show(frameAt(clip, time), foot, this.camera);
  }
  occlude(ground: Pick<GroundOcclusion, 'attach' | 'update'>) {
    for (const [sprite, placement] of this.occluded) {
      ground.attach(sprite, 'prop');
      ground.update(sprite, placement.x, placement.z);
    }
  }
  update(sim: SimulationView, alpha: number, visible: boolean, ms = 1000 / 60) {
    if (!this.playing) ms = 0;
    for (const { sprite: s, placement: p, ground } of this.animated) {
      s.animator.advance(ms);
      if (ground) this.poseGround(s, p);
      else {
        s.showAnimation(
          new T.Vector3(
            p.x,
            heightAt(this.area, p.x, p.z) +
              (p.y ?? (s.manifest.asset.projection === 'top-down' ? 0.018 : 0)),
            p.z,
          ),
          this.camera,
        );
        s.mesh.scale.set((p.scale ?? 1) * (p.mirror ? -1 : 1), p.scale ?? 1, p.scale ?? 1);
        if (p.rotation) s.mesh.rotateZ(p.rotation);
      }
      s.mesh.visible =
        visible &&
        !(
          s.animator.clip.endBehavior === 'hide' && s.animator.time >= clipDuration(s.animator.clip)
        );
    }
    for (const object of this.area.interactables ?? []) {
      const sprite = this.sprites.find((s) => s.id === object.object);
      const placement = this.art.props.find((p) => p.id === object.object);
      if (!sprite || !placement) continue;
      const heading = placement.heading ?? 'd45';
      const start = sim.objectActions.get(object.id);
      const elapsed =
        start === undefined ? Infinity : Math.max(0, ((sim.tick - start + alpha) * 1000) / 60);
      const claimed = sim.claimedObjects.has(object.id);
      const action = resolveClip(sprite.manifest, object.action, heading);
      const active = claimed && elapsed < clipDuration(action);
      const clip = resolveClip(
        sprite.manifest,
        claimed ? (active ? object.action : object.spent) : object.idle,
        heading,
      );
      // A crate's supplied smash clip includes its intact and broken poses.
      const time = !claimed
        ? 0
        : active
          ? elapsed
          : clip === action
            ? clipDuration(clip) - 0.001
            : 0;
      this.sample(
        sprite,
        clip,
        time,
        new T.Vector3(
          placement.x,
          heightAt(this.area, placement.x, placement.z) +
            (placement.y ?? (sprite.manifest.asset.projection === 'top-down' ? 0.018 : 0)),
          placement.z,
        ),
      );
      sprite.mesh.scale.set(
        (placement.scale ?? 1) * (placement.mirror ? -1 : 1),
        placement.scale ?? 1,
        placement.scale ?? 1,
      );
      if (placement.rotation) sprite.mesh.rotateZ(placement.rotation);
      sprite.mesh.visible =
        visible && !(claimed && !active && clip === action && clip.endBehavior === 'hide');
    }
    const pickups = this.area.pickups ?? [];
    const remaining = new Set(
      pickups.filter((p) => !sim.collectedPickups.has(p.id)).map((p) => p.object),
    );
    for (const object of new Set(pickups.map((p) => p.object))) {
      const sprite = this.sprites.find((s) => s.id === object);
      if (sprite)
        sprite.mesh.visible =
          visible &&
          remaining.has(object) &&
          !(
            sprite.animator.clip.endBehavior === 'hide' &&
            sprite.animator.time >= clipDuration(sprite.animator.clip)
          );
    }
    for (const s of this.effects.values()) s.mesh.visible = false;
    this.sceneryReveal.update(sim, alpha, ms);
    if (!visible) return;
    for (const drop of sim.drops) {
      const sprite = this.effect(
        'drop-' + drop.id,
        'library-lantern_concept_item_12_coin_purse',
        'still',
        drop,
      );
      sprite.mesh.visible = true;
      sprite.mesh.scale.setScalar(0.28);
      // Keep depth testing in the world pass; settle coincident stacks by identity.
      const order =
        (drop.id.split('').reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) /
          2 ** 32) *
        0.0001;
      sprite.mesh.renderOrder = order;
      if (sprite.edgeMesh) sprite.edgeMesh.renderOrder = order;
      this.sample(
        sprite,
        resolveClip(sprite.manifest, 'still', 'd45'),
        0,
        new T.Vector3(drop.x, heightAt(this.area, drop.x, drop.z) + 0.03, drop.z),
      );
    }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    const owned = this.owned,
      sprites = this.sprites.splice(0);
    this.owned = [];
    this.effects.clear();
    this.fades.length = 0;
    this.animated = [];
    this.occluded.clear();
    cleanupAll([
      () => this.sceneryReveal.dispose(),
      ...owned.map((resource) => () => resource.dispose()),
      () => this.contactShadows?.dispose(),
      ...sprites.map((sprite) => () => sprite.dispose()),
    ]);
  }
}
