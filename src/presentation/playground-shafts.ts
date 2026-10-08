import * as T from 'three';
import { FoliageWind } from './foliage-wind';
/** Authored opening beams, with an alpha-aware depth prepass for soft intersections. */
export class PlaygroundShafts {
  readonly group = new T.Group();
  private target = new T.WebGLRenderTarget(1, 1, {
    depthTexture: new T.DepthTexture(1, 1),
    depthBuffer: true,
  });
  private depths = new Map<T.Material, T.MeshDepthMaterial>();
  private size = new T.Vector2();
  private uniforms = {
    beamDepth: { value: this.target.depthTexture },
    beamSize: { value: new T.Vector2(1, 1) },
    beamTime: { value: 0 },
    beamPower: { value: 0.05 },
    beamRange: { value: 99.9 },
  };
  private material = new T.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: T.DoubleSide,
    uniforms: this.uniforms,
    vertexShader:
      'varying vec2 vUV;void main(){vUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUV;uniform sampler2D beamDepth;uniform vec2 beamSize;uniform float beamTime,beamPower,beamRange;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float field(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
 void main(){float depth=texture2D(beamDepth,gl_FragCoord.xy/beamSize).r;float soft=smoothstep(.025,.30,(depth-gl_FragCoord.z)*beamRange);float aperture=1.-smoothstep(.22,.5,abs(vUV.x-.5));float extent=smoothstep(0.,.15,vUV.y)*(1.-smoothstep(.75,1.,vUV.y));float noise=.62+.25*field(vUV*vec2(3.,4.)+vec2(beamTime*.025,-beamTime*.035))+.13*field(vUV*7.+beamTime*.04);float dust=pow(field(vUV*vec2(47.,72.)+vec2(beamTime*.08,-beamTime*.12)),24.)*.6;gl_FragColor=vec4(.53,.57,.59,aperture*extent*soft*(noise+dust)*beamPower);}`,
  });
  constructor() {
    for (const [x, y, z, dx, dz, width] of [
      [-3.5, 2.53, -1, 0.6, 2.4, 0.28],
      [0.3, 2.1, -4.78, 0.5, 2.8, 0.38],
    ]) {
      const g = new T.BufferGeometry();
      g.setAttribute(
        'position',
        new T.Float32BufferAttribute(
          [
            x! - width!,
            y!,
            z!,
            x! + width!,
            y!,
            z!,
            x! + dx! - width! * 2.2,
            0.035,
            z! + dz!,
            x! + dx! + width! * 2.2,
            0.035,
            z! + dz!,
          ],
          3,
        ),
      );
      g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      this.group.add(new T.Mesh(g, this.material));
    }
    this.group.visible = false;
  }
  update(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.OrthographicCamera,
    time: number,
    enabled: boolean,
    strength: number,
  ) {
    this.group.visible = enabled;
    if (!enabled) return;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x / 2)),
      h = Math.max(1, Math.round(this.size.y / 2));
    if (w !== this.target.width || h !== this.target.height) this.target.setSize(w, h);
    this.uniforms.beamSize.value.copy(this.size);
    this.uniforms.beamTime.value = time;
    this.uniforms.beamPower.value = 0.055 * strength;
    this.uniforms.beamRange.value = camera.far - camera.near;
    const restore: { mesh: T.Mesh; material: T.Material | T.Material[]; visible: boolean }[] = [],
      hidden: { object: T.Object3D; visible: boolean }[] = [],
      previousTarget = renderer.getRenderTarget(),
      shadow = renderer.shadowMap.enabled,
      clear = renderer.getClearColor(new T.Color()),
      alpha = renderer.getClearAlpha();
    this.group.visible = false;
    try {
      scene.traverseVisible((o) => {
        if (o instanceof T.Points) {
          hidden.push({ object: o, visible: o.visible });
          return;
        }
        if (!(o instanceof T.Mesh)) return;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        restore.push({ mesh: o, material: o.material, visible: o.visible });
        if (
          materials.some(
            (m) =>
              !(m instanceof T.MeshBasicMaterial || m instanceof T.MeshStandardMaterial) ||
              m.opacity < 0.98 ||
              (m.transparent && m.depthWrite === false),
          )
        ) {
          o.visible = false;
          return;
        }
        const replacements = materials.map((m) => {
          const source = m as T.MeshBasicMaterial;
          let depth = this.depths.get(m);
          if (!depth) {
            depth = new T.MeshDepthMaterial({
              map: source.map,
              alphaTest: source.map ? Math.max(0.35, source.alphaTest) : 0,
              side: m.side,
              depthPacking: T.BasicDepthPacking,
            });
            const wind = m.userData.foliageWind as FoliageWind | undefined;
            if (wind) wind.attach(depth);
            this.depths.set(m, depth);
          }
          depth.map = source.map;
          return depth;
        });
        o.material = Array.isArray(o.material) ? replacements : replacements[0]!;
      });
      for (const h of hidden) h.object.visible = false;
      renderer.shadowMap.enabled = false;
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      for (const r of restore) {
        r.mesh.material = r.material;
        r.mesh.visible = r.visible;
      }
      for (const h of hidden) h.object.visible = h.visible;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clear, alpha);
      renderer.shadowMap.enabled = shadow;
      this.group.visible = enabled;
    }
  }
  dispose() {
    for (const d of this.depths.values()) d.dispose();
    for (const beam of this.group.children) (beam as T.Mesh).geometry.dispose();
    this.material.dispose();
    this.target.dispose();
    this.group.removeFromParent();
  }
}
