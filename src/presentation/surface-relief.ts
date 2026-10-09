import * as T from 'three';
import type { PackLease } from '../assets/loader';
import type { VisualEffects } from '../content/visual-effects';
import { outward } from '../core/camera';
import { verifiedBitmap } from '../assets/bitmap';
type SurfaceSource = { asset: string; frame: string; pageHash: string };
/** Companions describe traced structure, and never modify the original paintings. */
export class SurfaceRelief {
  private texture?: T.Texture;
  private source?: SurfaceSource;
  private packs?: Map<string, PackLease>;
  private bindings: { normal: T.Uniform<number>; relief: T.Uniform<number> }[] = [];
  private disposed = false;
  async load(packs: Map<string, PackLease>) {
    this.packs = packs;
    // Curated flat-stage artwork has no procedural apron or height/UV companion.
    if (!packs.has('ink-graveyard-materials')) return;
    const response = await fetch('/visual-effects/surfaces.json');
    if (!response.ok) throw new Error('Surface companions unavailable');
    const data = await response.json();
    if (data.recipe !== 'hand-authored-stone-height-v1')
      throw new Error('Surface companion recipe differs');
    const entry = data.entries.apron as
      | (SurfaceSource & {
          file: string;
          hash: string;
          width: number;
          height: number;
        })
      | undefined;
    if (!entry) throw new Error('Graveyard surface companion unavailable');
    this.source = entry;
    this.validate();
    const bitmap = await verifiedBitmap('/visual-effects/' + entry.file, entry);
    if (this.disposed) {
      bitmap.close();
      return;
    }
    const texture = new T.Texture(bitmap);
    texture.flipY = false;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    this.texture = texture;
  }
  private validate() {
    const source = this.source!,
      pack = this.packs?.get(source.asset);
    if (pack) {
      const frame = pack.manifest.frames.find((f) => f.id === source.frame);
      if (!frame || pack.manifest.pages.find((p) => p.id === frame.page)?.hash !== source.pageHash)
        throw new Error('stale surface source: apron');
    }
  }
  attach(material: T.MeshBasicMaterial) {
    const key = material.customProgramCacheKey();
    if (
      material.userData.surfaceRelief ||
      !key.startsWith('last-tended-light-ground-v1:') ||
      !this.texture
    )
      return;
    this.validate();
    const normal = new T.Uniform(0),
      relief = new T.Uniform(0),
      previous = material.onBeforeCompile.bind(material);
    this.bindings.push({ normal, relief });
    material.userData.surfaceRelief = true;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      const marker = 'color=mix(color,texture2D(apronMap,terrainUV)';
      if (!shader.fragmentShader.includes(marker))
        throw new Error('Surface relief ground shader contract differs: apron');
      Object.assign(shader.uniforms, {
        surfaceCompanion: { value: this.texture },
        surfaceNormals: normal,
        surfaceRelief: relief,
      });
      shader.fragmentShader =
        `uniform sampler2D surfaceCompanion;uniform float surfaceNormals,surfaceRelief;float fxSurfaceWeight=0.;
vec2 fxReliefUV(vec2 q){vec2 uv=vec2(q.x,-q.y)/4.;float h=texture2D(surfaceCompanion,uv).a-.5;return uv-vec2(${outward.x},${-outward.z})/${outward.y}*h*.012*surfaceRelief;}
` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'vec3 n=inkNormal();',
          'vec3 n=inkNormal();if(inkIsGround>.5&&fxSurfaceWeight>0.){vec3 detail=texture2D(surfaceCompanion,fxReliefUV(inkWorld.xz)).rgb*2.-1.;n=normalize(mix(n,vec3(detail.x,detail.z,-detail.y),surfaceNormals*.40*fxSurfaceWeight));}',
        )
        .replace(
          marker,
          'fxSurfaceWeight=stone*.78;color=mix(color,texture2D(apronMap,fxReliefUV(q))',
        );
    };
    material.customProgramCacheKey = () => `${key}:surface-relief-v3:apron`;
    material.needsUpdate = true;
  }
  update(options: VisualEffects) {
    for (const b of this.bindings) {
      b.normal.value = options.surfaceDepth ? 1 : 0;
      b.relief.value = options.relief ? 1 : 0;
    }
  }
  reset() {
    this.bindings = [];
  }
  dispose() {
    this.disposed = true;
    if (this.texture) {
      (this.texture.image as ImageBitmap).close();
      this.texture.dispose();
      this.texture = undefined;
    }
    this.reset();
  }
}
