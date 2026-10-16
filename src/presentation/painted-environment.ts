import * as T from 'three';
import { cleanupAll } from '../assets/cleanup';
import { resolveClip } from '../assets/schema';
import type { AssetPack } from '../assets/loader';
import type { WorldVisualDefinition } from '../content/world-visuals';
import type { GroundOcclusion } from './ground-occlusion';

// A small, room-owned field samples the unlit painting, never the rendered frame.
// Upright painted scenery and black ink contribute no reflected ground color.
export class PaintedEnvironment {
  private disposed = false;
  readonly target = new T.WebGLRenderTarget(128, 128, { depthBuffer: false });
  private fallback = new T.DataTexture(new Uint8Array(4), 1, 1);
  private material = new T.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      source: { value: null as T.Texture | null },
      sourceRect: { value: new T.Vector4() },
      paintedMask: { value: this.fallback as T.Texture },
      hasMask: { value: 0 },
      sampleStep: { value: new T.Vector2() },
    },
    vertexShader:
      'varying vec2 fieldUV;void main(){fieldUV=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `
varying vec2 fieldUV;
uniform sampler2D source,paintedMask;uniform vec4 sourceRect;uniform vec2 sampleStep;uniform float hasMask;
void main(){
 vec3 sum=vec3(0.0);float count=0.0;
 for(int y=-3;y<=3;y++)for(int x=-3;x<=3;x++){
  vec2 p=fieldUV+vec2(float(x),float(y))*sampleStep;
  if(any(lessThan(p,vec2(0.0)))||any(greaterThan(p,vec2(1.0))))continue;
  if(hasMask>.5&&texture2D(paintedMask,vec2(p.x,1.0-p.y)).b>.1)continue;
  vec4 color=texture2D(source,sourceRect.xy+p*sourceRect.zw);
  float value=dot(color.rgb,vec3(.2126,.7152,.0722));
  if(color.a<.9||value<.008)continue;
  sum+=color.rgb;count+=1.0;
 }
 if(count<1.0){gl_FragColor=vec4(.5,.5,.5,0.0);return;}
 vec3 color=sum/count;float value=dot(color,vec3(.2126,.7152,.0722));
 gl_FragColor=vec4(clamp(color/value,vec3(.65),vec3(1.4))*.5,min(1.0,count/12.0));
}`,
  });
  private geometry = new T.PlaneGeometry(2, 2);
  private scene = new T.Scene();
  private camera = new T.Camera();
  available = false;
  constructor() {
    this.fallback.needsUpdate = true;
    this.scene.add(new T.Mesh(this.geometry, this.material));
  }
  build(
    renderer: T.WebGLRenderer,
    packs: ReadonlyMap<string, AssetPack>,
    visuals: WorldVisualDefinition | undefined,
    occlusion: GroundOcclusion | undefined,
  ) {
    if (this.disposed) throw new Error('painted environment disposed');
    this.reset();
    const floor = visuals?.editorFloor;
    if (!floor || floor.layout !== 'artwork') return;
    const pack = packs.get(floor.asset)!;
    const clip = resolveClip(pack.manifest, floor.clip, 'd45');
    const frame = pack.manifest.frames.find((f) => f.id === clip.frames[0])!;
    const page = pack.manifest.pages.find((p) => p.id === frame.page)!;
    const [x, y, w, h] = frame.rect;
    const u = this.material.uniforms;
    u.source!.value = pack.textures.get(frame.page)!;
    u.sourceRect!.value.set(
      x / page.width,
      1 - (y + h) / page.height,
      w / page.width,
      h / page.height,
    );
    u.paintedMask!.value = occlusion?.texture ?? this.fallback;
    u.hasMask!.value = occlusion ? 1 : 0;
    u.sampleStep!.value.set(0.18 / floor.width, 0.18 / floor.depth);
    this.target.setSize(
      128,
      Math.max(16, Math.min(128, Math.round((128 * floor.depth) / floor.width))),
    );
    const previous = renderer.getRenderTarget(),
      viewport = renderer.getViewport(new T.Vector4()),
      scissor = renderer.getScissor(new T.Vector4()),
      scissorTest = renderer.getScissorTest();
    try {
      renderer.setRenderTarget(this.target);
      renderer.setScissorTest(false);
      renderer.render(this.scene, this.camera);
      this.available = true;
    } finally {
      renderer.setRenderTarget(previous);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
    }
  }
  reset() {
    this.available = false;
    this.material.uniforms.source!.value = null;
    this.material.uniforms.paintedMask!.value = this.fallback;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    cleanupAll([
      () => this.target.dispose(),
      () => this.material.dispose(),
      () => this.geometry.dispose(),
      () => this.fallback.dispose(),
    ]);
  }
}
