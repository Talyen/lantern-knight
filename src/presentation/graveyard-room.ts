import { sceneFixtures } from '../content/scenery-presets';
import * as T from 'three';
import { ActorSprite } from './sprite';
import { graveyardGroundMaterial } from './graveyard-ground';
import { resolveClip } from '../assets/schema';
import type { PackLease } from '../assets/loader';
import type { WorldVisualDefinition } from '../content/world-art';
import { ChurchyardArchitecture } from './churchyard-architecture';
import { heightAt, type AreaDefinition } from '../content/world';
import { contract, outward, right, up } from '../core/camera';
import { frameAt, clipDuration } from '../core/animation';
import type { Simulation } from '../core/simulation';
import { SceneryReveal, cardCoverage, type CoverageMask } from './scenery-reveal';
import type { PreparedRegistration } from '../assets/registration';

export class GraveyardRoom {
  readonly architecture: ChurchyardArchitecture;
  private owned: { dispose: () => void }[] = [];
  private reveals: SceneryReveal[] = [];
  private time = 0;
  private ambient: {
    sprite: ActorSprite;
    clip: string;
    root: T.Vector3;
    phase: number;
    oneShot?: boolean;
  }[] = [];
  constructor(
    private area: AreaDefinition,
    private packs: Map<string, PackLease>,
    private group: T.Group,
    private camera: T.OrthographicCamera,
    private sprites: ActorSprite[],
    private fades: ActorSprite[],
    private shadowTexture: T.Texture | undefined,
    private coverage: PreparedRegistration['coverage'],
    private art: WorldVisualDefinition,
  ) {
    this.architecture = new ChurchyardArchitecture(packs, group, art);
  }
  private sprite(id: string, asset: string, clip: string) {
    const p = this.packs.get(asset);
    if (!p) throw new Error(`graveyard pack unavailable: ${asset}`);
    const s = new ActorSprite(id, p.manifest, p.textures, resolveClip(p.manifest, clip, 'd45'));
    this.sprites.push(s);
    this.group.add(s.mesh);
    s.mesh.userData.id = id;
    return s;
  }
  floorMaterial() {
    return graveyardGroundMaterial(this.packs, this.art);
  }

  build() {
    const art = this.art;
    this.architecture.build();
    for (const p of art.props) {
      if (p.asset.startsWith('library-')) continue;
      const s = this.sprite(p.id, p.asset, p.clip),
        scale = p.scale ?? 1;
      s.show(
        s.animator.frame,
        new T.Vector3(p.x, heightAt(this.area, p.x, p.z) + (p.y ?? 0), p.z),
        this.camera,
      );
      s.mesh.scale.set(scale * (p.mirror ? -1 : 1), scale, scale);
      s.material.color.set(p.tint ?? 0xffffff);
      s.edgeMaterial?.color.copy(s.material.color);
      s.mesh.userData.surfaceRole = p.role ?? 'upright';
      s.mesh.userData.assembly = p.assembly;
      if (p.fade) this.reveal(s);
      if (
        ![
          'fern',
          'bramble',
          'lantern',
          'cresset',
          'lantern-hardware',
          'cresset-hardware',
          'crook-lamp',
          'juniper',
        ].includes(p.clip) &&
        p.role !== 'ground'
      )
        this.cast(s);
      if (this.shadowTexture && p.footprint) {
        const g = new T.PlaneGeometry(...p.footprint),
          m = new T.MeshBasicMaterial({
            map: this.shadowTexture,
            color: 0x172521,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            opacity: 0.22,
          });
        const mesh = new T.Mesh(g, m);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(p.x, heightAt(this.area, p.x, p.z) + (p.y ?? 0) + 0.003, p.z);
        mesh.renderOrder = -1.55;
        this.group.add(mesh);
        this.owned.push(g, m);
      }
    }
    for (const fixture of sceneFixtures(art)) {
      if (!fixture.flame) continue;
      const parent = art.props.find((p) => p.id === fixture.prop)!,
        flame = fixture.flame;
      const root = new T.Vector3(
        parent.x + flame.offset[0],
        heightAt(this.area, parent.x, parent.z) + (parent.y ?? 0) + flame.offset[1],
        parent.z + flame.offset[2],
      );
      const s = this.sprite(fixture.id, flame.asset, flame.clip);
      s.mesh.userData.emissive = true;
      s.mesh.userData.surfaceRole = 'attachment';
      s.mesh.scale.setScalar(flame.scale);
      this.ambient.push({ sprite: s, clip: flame.clip, root, phase: flame.phase });
      if (fixture.smoke) {
        const smoke = this.sprite(`${fixture.id}-smoke`, 'ink-ambient', 'quiet_smoke');
        smoke.mesh.scale.setScalar(0.45);
        this.ambient.push({
          sprite: smoke,
          clip: 'quiet_smoke',
          root: root.clone().add(new T.Vector3(0, 0.1, 0)),
          phase: fixture.phase,
        });
      }
    }
    for (const [i, x, z] of [
      [0, -6.3, -2.1],
      [1, 7.2, 8.8],
    ]) {
      const leaf = this.sprite(`falling-leaf-${i}`, 'ink-ambient', 'tumbling_leaf');
      leaf.mesh.scale.setScalar(0.65);
      this.ambient.push({
        sprite: leaf,
        clip: 'tumbling_leaf',
        root: new T.Vector3(x!, heightAt(this.area, x!, z!) + 0.02, z!),
        phase: i! * 2.3,
        oneShot: true,
      });
    }
  }
  private cast(s: ActorSprite) {
    s.mesh.castShadow = true;
    const depth = new T.MeshDepthMaterial({
      map: s.material.map,
      alphaTest: 0.5,
      side: T.DoubleSide,
      depthPacking: T.RGBADepthPacking,
    });
    s.mesh.customDepthMaterial = depth;
    this.owned.push(depth);
    s.mesh.userData.ownsCastShadow = true;
  }
  private reveal(s: ActorSprite) {
    this.reveals.push(new SceneryReveal(s));
    this.fades.push(s);
  }
  update(sim: Simulation, alpha: number, ms: number) {
    this.architecture.update(sim, alpha, ms);
    this.time += Math.max(0, ms) / 1000;
    const actors = [sim.hero, ...sim.enemies.filter((a) => a.health > 0)];
    for (const reveal of this.reveals) {
      const s = reveal.sprite,
        wall = this.art.walls.find((w) => w.id === s.mesh.userData.siteWall),
        mask = (this.coverage.masks as Record<string, CoverageMask>)[
          `${s.manifest.asset.id}:${s.animator.frame}`
        ];
      const points = actors.map((a) => {
        const x = a.px + (a.x - a.px) * alpha,
          z = a.pz + (a.z - a.pz) * alpha,
          root = new T.Vector3(x, heightAt(this.area, x, z), z),
          height =
            (a.kind === 'hero' ? 1.8 : 1.7) * Math.cos((contract.elevationDeg * Math.PI) / 180),
          base = s.mesh.position.clone();
        if (wall) {
          const dx = wall.to.x - wall.from.x,
            dz = wall.to.z - wall.from.z,
            t = Math.max(
              0,
              Math.min(1, ((x - wall.from.x) * dx + (z - wall.from.z) * dz) / (dx * dx + dz * dz)),
            );
          base.set(wall.from.x + dx * t, root.y, wall.from.z + dz * t);
        }
        const ahead = root.clone().sub(base).dot(outward) < 0.1,
          hit =
            ahead &&
            [0.08, 0.18, 0.35, 0.65, 0.85].some((v) =>
              [-0.18, 0, 0.18].some(
                (offset) =>
                  cardCoverage(
                    s,
                    root
                      .clone()
                      .addScaledVector(up, height * v)
                      .addScaledVector(right, offset),
                    mask,
                  ) > 0.25,
              ),
            );
        return {
          center: new T.Vector2(root.dot(right), root.dot(up) + height * 0.51),
          size: new T.Vector2(0.62, height * 0.68),
          obscures: hit,
        };
      });
      reveal.update(points, ms);
    }
    for (const a of this.ambient) {
      const clip = resolveClip(a.sprite.manifest, a.clip, 'd45'),
        duration = clipDuration(clip),
        time = ((this.time + a.phase) % (a.oneShot ? 7 : duration / 1000)) * 1000;
      a.sprite.mesh.visible = !a.oneShot || time < duration;
      a.sprite.show(frameAt(clip, time), a.root, this.camera);
    }
  }
  revealStats() {
    return this.reveals.map((r) => ({
      id: r.sprite.id,
      strength: r.sprite.mesh.userData.revealStrength ?? 0,
      opacity: r.sprite.material.opacity,
      transparent: r.sprite.material.transparent,
      depthWrite: r.sprite.material.depthWrite,
    }));
  }
  dispose() {
    this.architecture.dispose();
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.reveals = [];
    this.ambient = [];
  }
}
