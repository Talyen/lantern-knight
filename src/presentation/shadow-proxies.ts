import { cleanupAll } from '../assets/cleanup';
import * as T from 'three';
import { ActorSprite } from './sprite';
import { AnimationBlendShader } from './animation-blend-shader';
import { FoliageWind } from './foliage-wind';
import { sceneryRegistration } from '../content/scenery-registration';
import { heightAt, type ActorId } from '../content/world';
import type { SimulationView } from '../core/simulation-view';
import type { WorldVisualDefinition } from '../content/world-visuals';
import { silhouetteQuaternion } from './silhouette-pose';
import { artworkFloorLayout } from '../content/floor-layout';
import { regionDepth } from './ground-occlusion';
import { outward } from './camera';

type Caster = {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  depth: T.MeshDepthMaterial;
  blend?: AnimationBlendShader;
};
export class ShadowProxies {
  readonly proxies = new T.Group();
  private casters = new Map<ActorSprite, Caster>();
  private scenery: ActorSprite[] = [];
  constructor(
    private sun: T.DirectionalLight,
    private localLights: readonly T.PointLight[] = [],
  ) {}
  build(
    sim: SimulationView,
    visuals: WorldVisualDefinition | undefined,
    sprites: readonly ActorSprite[],
  ) {
    const floor = visuals?.editorFloor,
      ground = visuals?.groundInteraction;
    if (floor && ground) {
      const layout = artworkFloorLayout(floor.width, floor.depth);
      for (const region of ground.regions) {
        if (!region.depth) continue;
        for (const mask of region.mask ?? []) {
          const shape = new T.Shape(mask.outer.map(([u, v]) => new T.Vector2(u, v)));
          shape.holes = mask.holes.map(
            (hole) => new T.Path(hole.map(([u, v]) => new T.Vector2(u, v))),
          );
          const geometry = new T.ShapeGeometry(shape),
            positions = geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            const u = positions.getX(i),
              point = layout.world([u, positions.getY(i)]);
            const lift = Math.max(
              0,
              (regionDepth(region, u, layout) - point.x * outward.x - point.z * outward.z) /
                (outward.x * outward.x + outward.z * outward.z),
            );
            positions.setXYZ(
              i,
              point.x + outward.x * lift,
              outward.y * lift,
              point.z + outward.z * lift,
            );
          }
          geometry.computeBoundingSphere();
          const mesh = new T.Mesh(
            geometry,
            new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: T.DoubleSide }),
          );
          this.shadowOnly(mesh);
          this.proxies.add(mesh);
        }
      }
    }
    for (const prop of visuals?.props ?? []) {
      if (prop.shadow === 'none' || prop.role === 'ground') continue;
      const sprite = sprites.find((s) => s.id === prop.id);
      if (sprite) {
        // A fixture's solid body casts; its separate luminous flame does not.
        if (
          (sprite.manifest.asset.type === 'effect' && !prop.fixture) ||
          sprite.manifest.asset.placement === 'ground' ||
          sprite.manifest.asset.placement === 'reference'
        )
          continue;
        this.scenery.push(sprite);
        continue;
      }
      const registration = sceneryRegistration.find((r) => r.id === prop.clip),
        h = (registration?.height ?? 1) * (prop.scale ?? 1),
        size = prop.footprint ?? [Math.min(1.5, h * 0.35), Math.min(1.5, h * 0.35)];
      const geometry =
        prop.clip.includes('tree') || prop.clip === 'yew'
          ? new T.CylinderGeometry(size[0] * 0.8, size[0] * 0.3, h, 7)
          : new T.BoxGeometry(size[0], h, size[1]);
      const mesh = new T.Mesh(
        geometry,
        new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
      );
      mesh.position.set(prop.x, heightAt(sim.areaDefinition, prop.x, prop.z) + h / 2, prop.z);
      this.shadowOnly(mesh);
      this.proxies.add(mesh);
    }
  }
  private shadowOnly(mesh: T.Mesh) {
    mesh.castShadow = true;
    mesh.frustumCulled = true;
    // Proxy geometry belongs only to the sun/local shadow passes, never beauty,
    // focus-mask or outline passes. Point faces reuse their light's frustum.
    mesh.intersectsFrustum = (frustum) =>
      (frustum === this.sun.shadow.getFrustum() ||
        this.localLights.some((l) => frustum === l.shadow.getFrustum())) &&
      T.Mesh.prototype.intersectsFrustum.call(mesh, frustum);
  }
  private updateSprite(sprite: ActorSprite) {
    let entry = this.casters.get(sprite);
    if (!entry) {
      const material = new T.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: false,
          alphaTest: 0.15,
          side: T.DoubleSide,
        }),
        depth = new T.MeshDepthMaterial({
          depthPacking: T.RGBADepthPacking,
          alphaTest: 0.15,
          side: T.DoubleSide,
        });
      const mesh = new T.Mesh(sprite.geometry, material);
      mesh.customDepthMaterial = mesh.customDistanceMaterial = depth;
      mesh.userData.sharedGeometry = true;
      this.shadowOnly(mesh);
      const wind = sprite.material.userData.foliageWind as FoliageWind | undefined;
      wind?.attach(depth);
      entry = { mesh, depth };
      this.casters.set(sprite, entry);
      this.proxies.add(mesh);
    }
    entry.mesh.position.copy(sprite.mesh.position);
    silhouetteQuaternion(sprite, entry.mesh.quaternion);
    entry.mesh.scale.copy(sprite.mesh.scale);
    entry.mesh.visible = sprite.mesh.visible && sprite.material.opacity > 0.05;
    if (!entry.mesh.material.map) {
      entry.mesh.material.needsUpdate = true;
      entry.depth.needsUpdate = true;
    }
    entry.mesh.material.map = entry.depth.map = sprite.material.map;
    const s = sprite.lightingSample;
    if (s?.blend && s.next) {
      entry.blend ??= new AnimationBlendShader([entry.depth as unknown as T.MeshBasicMaterial]);
      entry.blend.update(
        s.blend,
        sprite.manifest,
        s.frame,
        s.next,
        sprite.textures,
        s.flow,
        sprite.stabilized,
        sprite.rigidSword,
      );
    } else if (entry.blend) entry.blend.uniforms.walkEnabled.value = 0;
  }
  updateActor(_id: ActorId, sprite: ActorSprite) {
    this.updateSprite(sprite);
  }
  updateScenery(sprites: readonly ActorSprite[]) {
    for (const sprite of this.scenery) this.updateSprite(sprite);
    for (const sprite of sprites) if (sprite.id.startsWith('drop-')) this.updateSprite(sprite);
  }
  reset() {
    const actions: (() => void)[] = [];
    this.proxies.traverse((o) => {
      if (o instanceof T.Mesh) {
        if (!o.userData.sharedGeometry) actions.push(() => o.geometry.dispose());
        actions.push(
          () => o.material.dispose(),
          () => o.customDepthMaterial?.dispose(),
        );
      }
    });
    this.proxies.clear();
    this.casters.clear();
    this.scenery = [];
    cleanupAll(actions);
  }
}
