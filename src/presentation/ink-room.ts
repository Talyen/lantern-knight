import { sceneFixtures, type ResolvedFixture } from '../content/scenery-presets';
import type { PreparedRegistration } from '../assets/registration';
import * as T from 'three';
import { ActorSprite } from './sprite';
import { OcclusionFades } from './occlusion-fades';
import { CryptArchitecture } from './crypt-architecture';
import { GraveyardRoom } from './graveyard-room';
import { resolveClip, type Clip } from '../assets/schema';
import type { PackLease } from '../assets/loader';
import { worldVisuals, type WorldVisualDefinition, type ArtPlacement } from '../content/world-art';
import { heightAt, type AreaDefinition } from '../content/world';
import { outward } from '../core/camera';
import { clipDuration, frameAt } from '../core/animation';
import type { Simulation } from '../core/simulation';

export class InkRoom {
  readonly sprites: ActorSprite[] = [];
  readonly fades: ActorSprite[] = [];
  readonly effects = new Map<string, ActorSprite>();
  readonly occlusion = new OcclusionFades();
  readonly architecture: CryptArchitecture | undefined;
  readonly graveyard: GraveyardRoom | undefined;
  private time = 0;
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
    readonly art: WorldVisualDefinition = worldVisuals[area.id]!,
  ) {
    if (art?.interior && !art.editorFloor)
      this.architecture = new CryptArchitecture(area, art, packs, room, this.occlusion);
    if (area.id === 'court')
      this.graveyard = new GraveyardRoom(
        area,
        packs,
        room,
        camera,
        this.sprites,
        this.fades,
        shadowTexture,
        registration.coverage,
        art,
      );
  }
  private sprite(id: string, asset: string, clip: string) {
    const p = this.packs.get(asset);
    if (!p) throw new Error(`room art not acquired: ${asset}`);
    const s = new ActorSprite(id, p.manifest, p.textures, resolveClip(p.manifest, clip, 'd45'));
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
    if (this.graveyard) return this.graveyard.floorMaterial();
    if (this.architecture) return this.architecture.floorMaterial();
    throw new Error(`No authored floor architecture for ${this.area.id}`);
  }
  private owned: { dispose: () => void }[] = [];
  private castShadows: {
    sprite: ActorSprite;
    mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  }[] = [];
  private staticShadows: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>[] = [];
  // Active interiors use authored painted architecture.
  private walls() {
    this.architecture?.build();
  }

  private ground(p: ArtPlacement, asset = p.asset) {
    const s = this.sprite(p.id, asset, p.clip),
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
    s.material.color.set(p.tint ?? 0xb7c2b6);
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
    return s;
  }
  private pathEdges() {
    const art = this.art;
    for (const [pi, path] of art.paths.entries())
      for (let i = 1; i < path.points.length; i++) {
        const from = path.points[i - 1]!,
          to = path.points[i]!,
          dx = to.x - from.x,
          dz = to.z - from.z,
          length = Math.hypot(dx, dz),
          n = Math.ceil(length / 1.7);
        for (const side of [-1, 1])
          for (let j = 0; j < n; j++) {
            const t = (j + 0.5) / n,
              x = from.x + dx * t - (((dz / length) * path.width) / 2) * side,
              z = from.z + dz * t + (((dx / length) * path.width) / 2) * side;
            this.ground({
              asset: 'ink-ground-transitions',
              purpose: 'Procedural path edge',
              id: `path-edge-${pi}-${i}-${side}-${j}`,
              clip: 't03_broken_pavement_edge',
              x,
              z,
              scale: 0.44,
              rotation: Math.atan2(-dz, dx),
              tint: 0xbfc8bd,
            });
          }
      }
  }
  build() {
    if (this.graveyard) {
      this.graveyard.build();
      for (const p of this.art.decals) if (p.asset !== 'ink-graveyard-overlays') this.ground(p);
      return;
    }
    const art = this.art;
    this.walls();
    this.pathEdges();
    for (const plot of art.graves)
      this.ground({
        purpose: 'Procedural burial soil',
        id: `soil-${plot.id}`,
        clip: 'grave-soil',
        asset: 'ink-soil',
        x: plot.x,
        z: plot.z,
        scale: plot.age === 'old' ? 0.94 : 1,
        tint: 0xc3c7b7,
      });
    for (const p of art.props) this.place(p);
    for (const p of art.decals) this.ground(p);
  }
  private place(p: ArtPlacement) {
    const s = this.sprite(p.id, p.asset, p.clip),
      scale = p.scale ?? 1;
    s.show(
      s.animator.frame,
      new T.Vector3(p.x, heightAt(this.area, p.x, p.z) + (p.y ?? 0), p.z),
      this.camera,
    );
    s.mesh.scale.set(scale * (p.mirror ? -1 : 1), scale, scale);
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
      this.occlusion.add(s.mesh, p.assembly ?? p.id);
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
    for (const s of this.effects.values()) s.mesh.visible = false;
    this.graveyard?.update(sim, alpha, ms);
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
    if (this.architecture && visible) {
      const motes = this.effect('crypt-motes', 'ink-crypt-ambient', 'rising_motes');
      motes.mesh.visible = true;
      motes.mesh.userData.decorative = true;
      motes.mesh.scale.setScalar(0.28);
      motes.material.opacity = 0.32;
      this.sample(motes, motes.animator.clip, this.time + 710, new T.Vector3(0, 1.8, -6.95));
      const phase = this.time % 9500;
      for (const [id, clipId, duration] of [
        ['crypt-drop', 'droplet_splash', 1000],
        ['crypt-ripple', 'pond_ripple', 2000],
      ] as const) {
        const effect = this.effect(id, 'ink-crypt-ambient', clipId);
        effect.mesh.visible = phase < duration;
        effect.mesh.userData.decorative = true;
        effect.mesh.scale.setScalar(0.2);
        effect.material.opacity = 0.5;
        this.sample(
          effect,
          effect.animator.clip,
          phase,
          new T.Vector3(5.3, heightAt(this.area, 5.3, -0.2) + 0.025, -0.2),
        );
      }
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
    this.graveyard?.dispose();
    this.architecture?.dispose();
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
