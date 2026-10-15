import { cleanupAll } from '../assets/cleanup';
import * as T from 'three';
import { ActorSprite } from './sprite';
import { outward } from './camera';
import { AnimationBlendShader } from './animation-blend-shader';
import { FoliageWind } from './foliage-wind';
import type { ActorId } from '../content/world';
import type { WorldVisualDefinition } from '../content/world-visuals';
type Caster = {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  depth: T.MeshDepthMaterial;
  blend?: AnimationBlendShader;
};
export class ShadowProxies {
  readonly proxies = new T.Group();
  private actorCasters = new Map<ActorId, Caster>();
  private upright = new T.Quaternion().setFromUnitVectors(
    new T.Vector3(0, 0, 1),
    new T.Vector3(outward.x, 0, outward.z).normalize(),
  );
  constructor(private sun: T.DirectionalLight) {}
  build(visuals: WorldVisualDefinition | undefined, sprites: readonly ActorSprite[]) {
    for (const prop of visuals?.props ?? []) {
      if (
        prop.shadow === 'none' ||
        prop.shadow === 'contact' ||
        prop.fixture ||
        prop.clip === 'lantern' ||
        prop.clip === 'stairs' ||
        prop.clip === 'fern' ||
        prop.clip === 'rubble'
      )
        continue;
      const sprite = sprites.find((s) => s.id === prop.id);
      if (
        sprite?.manifest.asset.type === 'effect' ||
        prop.role === 'ground' ||
        prop.role === 'attachment'
      )
        continue;
      if (sprite) {
        const material = new T.MeshBasicMaterial({
          map: sprite.material.map,
          alphaTest: 0.8,
          side: T.DoubleSide,
          colorWrite: false,
          depthWrite: false,
        });
        const mesh = new T.Mesh(sprite.geometry, material);
        mesh.position.copy(sprite.mesh.position);
        mesh.quaternion.copy(sprite.mesh.quaternion);
        mesh.scale.copy(sprite.mesh.scale);
        this.shadowOnly(mesh);
        const wind = sprite.material.userData.foliageWind as FoliageWind | undefined;
        if (wind) {
          const depth = new T.MeshDepthMaterial({
            map: sprite.material.map,
            alphaTest: 0.8,
            side: T.DoubleSide,
            depthPacking: T.RGBADepthPacking,
          });
          wind.attach(depth);
          mesh.customDepthMaterial = depth;
        }
        this.proxies.add(mesh);
        continue;
      }
      throw new Error('Missing shadow caster artwork: ' + prop.id);
    }
  }
  private shadowOnly(mesh: T.Mesh) {
    // Three r186 exposes per-object frustum tests. Only the sun's frustum may draw
    // these casters: colorWrite:false alone would still rasterize them in the beauty pass.
    mesh.castShadow = true;
    mesh.frustumCulled = true;
    mesh.intersectsFrustum = (frustum) =>
      frustum === this.sun.shadow.getFrustum() &&
      T.Mesh.prototype.intersectsFrustum.call(mesh, frustum);
  }
  updateActor(id: ActorId, sprite: ActorSprite) {
    let entry = this.actorCasters.get(id);
    if (!entry) {
      const material = new T.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: false,
          alphaTest: 0.35,
          side: T.DoubleSide,
        }),
        depth = new T.MeshDepthMaterial({
          depthPacking: T.RGBADepthPacking,
          alphaTest: 0.35,
          side: T.DoubleSide,
        });
      const mesh = new T.Mesh(sprite.geometry, material);
      mesh.customDepthMaterial = depth;
      this.shadowOnly(mesh);
      entry = { mesh, depth };
      this.actorCasters.set(id, entry);
      this.proxies.add(mesh);
    }
    entry.mesh.position.copy(sprite.mesh.position);
    // The beauty sprite leans into the camera plane. Its physical caster stands
    // upright so the sun projects a silhouette beyond the actor's feet.
    entry.mesh.quaternion.copy(
      sprite.manifest.asset.projection === 'front-view' ||
        sprite.manifest.asset.projection === 'top-down'
        ? sprite.mesh.quaternion
        : this.upright,
    );
    entry.mesh.scale.copy(sprite.mesh.scale);
    entry.mesh.visible = sprite.mesh.visible;
    if (!entry.mesh.material.map) {
      entry.mesh.material.needsUpdate = true;
      entry.depth.needsUpdate = true;
    }
    entry.mesh.material.map = sprite.material.map;
    entry.depth.map = sprite.material.map;
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
  reset() {
    const actions: (() => void)[] = [];
    this.proxies.traverse((o) => {
      if (o instanceof T.Mesh) {
        actions.push(
          () => (o.material as T.Material).dispose(),
          () => o.customDepthMaterial?.dispose(),
        );
      }
    });
    this.proxies.clear();
    this.actorCasters.clear();
    cleanupAll(actions);
  }
}
