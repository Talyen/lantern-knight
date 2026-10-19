import { cleanupAll } from '../assets/cleanup';
import * as T from 'three';
import { ActorSprite } from './sprite';
import { AnimationBlendShader } from './animation-blend-shader';
import { FoliageWind } from './foliage-wind';
import type { ActorId } from '../content/world';
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
  build(visuals: WorldVisualDefinition | undefined, sprites: readonly ActorSprite[]) {
    const floor = visuals?.editorFloor,
      ground = visuals?.groundInteraction;
    if (floor && ground) {
      const layout = artworkFloorLayout(floor.width, floor.depth);
      for (const region of ground.regions) {
        if (!region.depth) continue;
        // Native masks contain thousands of disconnected contour islands. They
        // share one opaque shadow material and transform: submit their unchanged
        // triangles once per region, not once per island on every shadow face.
        const batch: number[] = [];
        for (const mask of region.mask ?? []) {
          const shape = new T.Shape(mask.outer.map(([u, v]) => new T.Vector2(u, v)));
          shape.holes = mask.holes.map(
            (hole) => new T.Path(hole.map(([u, v]) => new T.Vector2(u, v))),
          );
          const geometry = new T.ShapeGeometry(shape);
          // A contact boundary is piecewise linear in image X. Split triangles
          // at every bend so the caster and per-pixel receiver agree between
          // contour vertices, including broad canopy interiors.
          if (region.depth.kind === 'boundary') {
            const source = geometry.getAttribute('position'),
              indices = geometry.getIndex()!,
              cuts = region.depth.points.map((p) => layout.uv(p)[0]),
              vertices: number[] = [];
            for (let i = 0; i < indices.count; i += 3) {
              let pieces = [
                [0, 1, 2].map((j) => {
                  const index = indices.getX(i + j);
                  return new T.Vector2(source.getX(index), source.getY(index));
                }),
              ];
              for (const cut of cuts) {
                pieces = pieces.flatMap((polygon) => {
                  if (!polygon.some((p) => p.x < cut) || !polygon.some((p) => p.x > cut))
                    return [polygon];
                  const halves: T.Vector2[][] = [[], []];
                  for (let j = 0; j < polygon.length; j++) {
                    const a = polygon[j]!,
                      b = polygon[(j + 1) % polygon.length]!;
                    if (a.x <= cut) halves[0]!.push(a);
                    if (a.x >= cut) halves[1]!.push(a);
                    if ((a.x < cut && b.x > cut) || (a.x > cut && b.x < cut)) {
                      const p = a.clone().lerp(b, (cut - a.x) / (b.x - a.x));
                      halves[0]!.push(p);
                      halves[1]!.push(p);
                    }
                  }
                  return halves;
                });
              }
              for (const polygon of pieces)
                for (let j = 1; j < polygon.length - 1; j++)
                  for (const p of [polygon[0]!, polygon[j]!, polygon[j + 1]!])
                    vertices.push(p.x, p.y, 0);
            }
            geometry.setIndex(null);
            geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
            geometry.deleteAttribute('normal');
            geometry.deleteAttribute('uv');
          }
          const positions = geometry.getAttribute('position');
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
          const indices = geometry.getIndex();
          for (let i = 0; i < (indices?.count ?? positions.count); i++) {
            const index = indices ? indices.getX(i) : i;
            batch.push(positions.getX(index), positions.getY(index), positions.getZ(index));
          }
          geometry.dispose();
        }
        if (batch.length) {
          const geometry = new T.BufferGeometry();
          geometry.setAttribute('position', new T.Float32BufferAttribute(batch, 3));
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
      if (prop.shadow === 'none' || prop.shadow === 'contact-only' || prop.role === 'ground')
        continue;
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
      throw new Error('Missing shadow caster artwork: ' + prop.id);
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
      entry = {
        mesh,
        depth,
        ...(sprite.manifest.asset.type === 'character'
          ? { blend: new AnimationBlendShader([depth as unknown as T.MeshBasicMaterial]) }
          : {}),
      };
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
