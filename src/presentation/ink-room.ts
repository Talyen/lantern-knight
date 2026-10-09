import { sceneFixtures, type ResolvedFixture } from '../content/scenery-presets';
import type { PreparedRegistration } from '../assets/registration';
import * as T from 'three';
import { ActorSprite } from './sprite';
import { OcclusionFades } from './occlusion-fades';
import { graveyardGroundMaterial } from './graveyard-ground';
import { SceneryReveals } from './scenery-reveals';
import { resolveClip, type Clip } from '../assets/schema';
import type { PackLease } from '../assets/loader';
import { type WorldVisualDefinition, type ArtPlacement } from '../content/world-art';
import { heightAt, type AreaDefinition } from '../content/world';
import { outward } from '../core/camera';
import { clipDuration, frameAt } from '../core/animation';
import type { Simulation } from '../core/simulation';

export class InkRoom {
  readonly sprites: ActorSprite[] = [];
  readonly effects = new Map<string, ActorSprite>();
  readonly fades: ActorSprite[] = [];
  readonly occlusion = new OcclusionFades();
  readonly sceneryReveal: SceneryReveals | undefined;
  private time = 0;
  playing = true;
  private animated: { sprite: ActorSprite; placement: ArtPlacement }[] = [];
  replay() {
    this.time = 0;
    for (const { sprite } of this.animated) sprite.animator.start(sprite.animator.clip);
  }
  get ambientTime() {
    return this.time / 1000;
  }
  private flames: {
    fixture: ActorSprite;
    emission: ActorSprite;
    placement: ArtPlacement;
    settings: ResolvedFixture;
  }[] = [];
  private gates: { sprite: ActorSprite; seal: ActorSprite; x: number; z: number }[] = [];
  constructor(
    readonly area: AreaDefinition,
    private packs: Map<string, PackLease>,
    private room: T.Group,
    private camera: T.OrthographicCamera,
    private shadowTexture: T.Texture | undefined,
    readonly registration: PreparedRegistration,
    readonly art: WorldVisualDefinition,
  ) {
    if (!art.interior) this.sceneryReveal = new SceneryReveals(area, registration.coverage, art);
  }

  private sprite(
    id: string,
    asset: string,
    clip: string,
    heading: ArtPlacement['heading'] = 'd45',
  ) {
    const p = this.packs.get(asset);
    if (!p) throw new Error(`room art not acquired: ${asset}`);
    const s = new ActorSprite(id, p.manifest, p.textures, resolveClip(p.manifest, clip, heading));
    this.sprites.push(s);
    this.room.add(s.mesh);
    return s;
  }
  floorMaterial() {
    if (this.art.editorFloor) {
      const f = this.art.editorFloor,
        pack = this.packs.get(f.asset)!,
        clip = resolveClip(pack.manifest, f.clip, 'd45'),
        frame = pack.manifest.frames.find((f) => f.id === clip.frames[0])!;
      const map = pack.textures.get(frame.page)!.clone();
      map.wrapS = map.wrapT = T.RepeatWrapping;
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
          'diffuseColor *= texture2D(map,editorFloorRect.xy+fract(vMapUv)*editorFloorRect.zw);',
        );
      };
      material.customProgramCacheKey = () => 'editor-floor:' + pack.manifest.hash + ':' + f.clip;
      return material;
    }
    return graveyardGroundMaterial(this.packs, this.art);
  }
  private owned: { dispose: () => void }[] = [];
  private castShadows: {
    sprite: ActorSprite;
    mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  }[] = [];
  private staticShadows: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>[] = [];
  private ground(p: ArtPlacement, asset = p.asset) {
    const s = this.sprite(p.id, asset, p.clip, p.heading),
      scale = p.scale ?? 1,
      angle = p.rotation ?? 0;
    s.show(
      s.animator.frame,
      new T.Vector3(p.x, heightAt(this.area, p.x, p.z) + 0.018, p.z),
      this.camera,
    );
    s.mesh.scale.set(scale * (p.mirror ? -1 : 1), scale, scale);
    s.mesh.rotateZ(angle);
    s.mesh.renderOrder = -1.9;
    s.material.color.set(p.tint ?? 0xffffff);
    s.material.opacity = p.opacity ?? 1;
    const vertices = s.geometry.getAttribute('position'),
      c = Math.cos(angle),
      sn = Math.sin(angle);
    for (let i = 0; i < vertices.count; i++) {
      const lx = vertices.getX(i) * scale,
        ly = vertices.getY(i) * scale,
        x = p.x + lx * c - ly * sn,
        z = p.z - lx * sn - ly * c;
      vertices.setZ(i, (heightAt(this.area, x, z) - heightAt(this.area, p.x, p.z)) / scale);
    }
    s.mesh.userData.id = p.id;
    vertices.needsUpdate = true;
    if (s.animator.clip.frames.length > 1) this.animated.push({ sprite: s, placement: p });
    return s;
  }
  build() {
    const art = this.art;
    for (const p of art.props) this.place(p);
    for (const p of art.decals) this.ground(p);
  }
  private place(p: ArtPlacement) {
    const s = this.sprite(p.id, p.asset, p.clip, p.heading),
      scale = p.scale ?? 1;
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
      s.mesh.userData.emissive = true;
    }
    if (p.tint) {
      s.material.color.set(p.tint);
      s.edgeMaterial?.color.copy(s.material.color);
    }
    // Reversible runtime matte rejects generated backdrop residue without changing sources.

    s.mesh.userData.artPart = {
      id: p.id,
      role: p.wallFace ? 'mounted-face' : p.mount ? 'mounted-fixture' : 'prop',
      assembly: p.assembly,
      mount: p.mount,
      footprint: p.footprint,
    };
    if (p.wallFace) {
      const wall = this.art.walls.find((w) => w.id === p.wallFace)!;
      s.mesh.rotation.y = Math.atan2(-(wall.to.z - wall.from.z), wall.to.x - wall.from.x);
    }
    if (p.fade) {
      this.fades.push(s);
      if (this.sceneryReveal) this.sceneryReveal.add(s);
      else this.occlusion.add(s.mesh, p.assembly ?? p.id);
    }
    const fixture = sceneFixtures(this.art).find((f) => f.prop === p.id);
    if (fixture?.flame) {
      const settings = fixture.flame,
        emission = this.sprite(fixture.id, settings.asset, settings.clip);
      emission.mesh.userData.emissive = true;
      emission.mesh.userData.decorative = settings.decorative;
      this.flames.push({ fixture: s, emission, placement: p, settings: fixture });
    }
    if (
      s.manifest.asset.type !== 'effect' &&
      s.animator.clip.frames.length === 1 &&
      (p.shadow === undefined || p.shadow === 'cast') &&
      !['lantern', 'cresset', 'votive', 'roots', 'fern', 'bramble'].includes(p.clip)
    ) {
      const g = s.geometry.clone(),
        position = g.getAttribute('position');
      s.mesh.updateMatrixWorld(true);
      for (let i = 0; i < position.count; i++) {
        const v = new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(s.mesh.matrixWorld),
          h = Math.max(0, v.y - heightAt(this.area, p.x, p.z));
        v.x += h * 0.6;
        v.z += h * 0.45;
        v.y = heightAt(this.area, v.x, v.z) + 0.012;
        position.setXYZ(i, v.x, v.y, v.z);
      }
      position.needsUpdate = true;
      g.computeBoundingSphere();
      const m = new T.MeshBasicMaterial({
        map: s.material.map,
        transparent: true,
        opacity: p.clip === 'yew' ? 0.22 : 0.26,
        alphaTest: 0.8,
        depthWrite: false,
        side: T.DoubleSide,
        color: 0x142122,
      });
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          '#ifdef USE_MAP\ndiffuseColor.a*=texture2D(map,vMapUv).a;\n#endif',
        );
      };
      m.customProgramCacheKey = () => 'rest-silhouette-shadow-v1';
      const shadow = new T.Mesh(g, m);
      shadow.renderOrder = -1.5;
      this.room.add(shadow);
      shadow.userData.baseOpacity = m.opacity;
      this.castShadows.push({ sprite: s, mesh: shadow });
      this.owned.push(g, m);
    }
    if (this.shadowTexture && p.footprint && p.shadow !== 'none') {
      const shadow = new T.Mesh(
        new T.PlaneGeometry(...p.footprint),
        new T.MeshBasicMaterial({
          map: this.shadowTexture,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          opacity: 0.32,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(p.x, heightAt(this.area, p.x, p.z) + 0.012, p.z);
      shadow.renderOrder = -1.5;
      this.room.add(shadow);
      shadow.userData.sprite = s;
      shadow.userData.baseOpacity = 0.32;
      this.staticShadows.push(shadow);
    }
    return s;
  }
  private effect(id: string, asset: string, clip: string) {
    let s = this.effects.get(id);
    if (!s) {
      s = this.sprite(id, asset, clip);
      s.mesh.renderOrder = -0.5;
      this.effects.set(id, s);
    }
    return s;
  }
  private sample(s: ActorSprite, clip: Clip, time: number, foot: T.Vector3) {
    s.show(frameAt(clip, time), foot, this.camera);
  }
  update(sim: Simulation, alpha: number, visible: boolean, ms = 1000 / 60) {
    if (!this.playing) ms = 0;
    for (const { sprite: s, placement: p } of this.animated) {
      s.animator.advance(ms);
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
      s.mesh.visible =
        visible &&
        !(
          s.animator.clip.endBehavior === 'hide' && s.animator.time >= clipDuration(s.animator.clip)
        );
    }
    for (const s of this.effects.values()) s.mesh.visible = false;
    this.sceneryReveal?.update(sim, alpha, ms);
    this.time += Math.max(0, ms);
    this.occlusion.update(sim, alpha, ms);
    for (const cast of this.castShadows) {
      cast.mesh.visible = cast.sprite.mesh.visible;
      cast.mesh.material.opacity = cast.mesh.userData.baseOpacity * cast.sprite.material.opacity;
    }
    for (const shadow of this.staticShadows) {
      const sprite = shadow.userData.sprite as ActorSprite;
      shadow.visible = sprite.mesh.visible;
      shadow.material.opacity = shadow.userData.baseOpacity * sprite.material.opacity;
    }
    for (const { fixture, emission, settings } of this.flames) {
      const f = settings.flame!,
        clip = emission.animator.clip,
        foot = fixture.mesh.position.clone().add(new T.Vector3(...f.offset));
      foot.addScaledVector(outward, f.depthOffset);
      this.sample(emission, clip, this.time + f.phase * 1000, foot);
      emission.mesh.scale.setScalar(f.scale);
      emission.mesh.visible = visible;
      emission.material.opacity = fixture.material.opacity;
    }
    for (const g of this.gates) {
      g.seal.mesh.visible = visible && !sim.cleared;
      if (g.seal.mesh.visible) {
        const c = resolveClip(g.seal.manifest, 'door_seal_dissolve', 'd45');
        this.sample(
          g.seal,
          c,
          clipDuration(c) * 0.4,
          new T.Vector3(g.x, heightAt(this.area, g.x, g.z) + 0.02, g.z),
        );
      }
    }
    if (!visible) return;

    for (const a of sim.enemies)
      if (a.health > 0 && a.state === 'attack') {
        const s = this.effect(`telegraph-${a.id}`, 'ink-cues', 'enemy_ring'),
          c = resolveClip(s.manifest, 'enemy_ring', 'd45');
        s.mesh.visible = true;
        // Ring radius follows authoritative reach; artwork is only a cue.
        s.mesh.scale.setScalar(a.definition.melee.range / 2);
        this.sample(
          s,
          c,
          Math.min(0.99, a.age / a.definition.melee.total) * clipDuration(c),
          new T.Vector3(a.px + (a.x - a.px) * alpha, a.y + 0.025, a.pz + (a.z - a.pz) * alpha),
        );
      }
  }
  dispose() {
    this.sceneryReveal?.dispose();
    this.owned.forEach((v) => v.dispose());
    this.owned = [];
    for (const s of this.staticShadows) {
      s.geometry.dispose();
      s.material.dispose();
      s.removeFromParent();
    }
    this.staticShadows = [];
    for (const s of this.sprites) s.dispose();
    this.effects.clear();
  }
}
