import {
  Color,
  Vector2,
  Vector4,
  type Mesh,
  type BufferAttribute,
  type MeshBasicMaterial,
  type PlaneGeometry,
  type WebGLRenderer,
} from 'three';

/** The approved silhouette stroke: 1 CSS pixel inside and 1 outside. */
export class SpriteOutline {
  enabled = true;
  private positionsVersion = -1;
  private uvVersion = -1;
  private attached = new WeakSet<MeshBasicMaterial>();
  private uniforms = {
    spriteOutlineEnabled: { value: 1 },
    spriteOutlineViewport: { value: new Vector2(1, 1) },
    spriteOutlinePixelRatio: { value: 1 },
    spriteOutlineCenter: { value: new Vector2() },
    spriteOutlineUVPerUnit: { value: new Vector2() },
    spriteOutlineRect: { value: new Vector4() },
    spriteOutlineDepthSlope: { value: 0 },
    spriteOutlineColor: { value: new Color(0x080808) },
  };
  constructor(
    private geometry: PlaneGeometry,
    private character: boolean,
  ) {}

  attach(material: MeshBasicMaterial, color = true) {
    if (this.attached.has(material)) return;
    this.attached.add(material);
    const previous = material.onBeforeCompile.bind(material),
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        `#ifdef USE_MAP
#define HAS_SPRITE_OUTLINE 1
#endif
uniform float spriteOutlineEnabled,spriteOutlineDepthSlope;
uniform vec2 spriteOutlineViewport,spriteOutlineCenter,spriteOutlineUVPerUnit;
` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_MAP
if(spriteOutlineEnabled>.5){
  vec2 dx=(projectionMatrix*modelViewMatrix*vec4(1.,0.,0.,0.)).xy*spriteOutlineViewport*.5;
  vec2 dy=(projectionMatrix*modelViewMatrix*vec4(0.,1.,spriteOutlineDepthSlope,0.)).xy*spriteOutlineViewport*.5;
  vec2 pad=1./max(vec2(length(dx),length(dy)),vec2(.001));
  vec2 offset=sign(position.xy-spriteOutlineCenter)*pad;
  transformed.xy+=offset;
  transformed.z+=offset.y*spriteOutlineDepthSlope;
  vMapUv+=offset*spriteOutlineUVPerUnit;
  ${this.character ? 'vWalkCanvas+=vec2(offset.x,-offset.y)*spriteOutlineUVPerUnit;' : ''}
}
#endif`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main()',
        `#ifdef USE_MAP
#define HAS_SPRITE_OUTLINE 1
uniform float spriteOutlineEnabled,spriteOutlinePixelRatio;
uniform vec4 spriteOutlineRect;
uniform vec3 spriteOutlineColor;
float spriteSourceAlpha;
float spriteOutlineMix=0.;
vec3 spriteAlphasAt(vec2 offset){
#ifdef HAS_WALK_BLEND
  if(walkEnabled>.5){
    vec4 a,b;float blend;
    walkLayersAt(vWalkCanvas+vec2(offset.x,-offset.y),a,b,blend);
    return vec3(a.a,b.a,blend);
  }
#endif
  vec2 p=vMapUv+offset;
  if(any(lessThan(p,spriteOutlineRect.xy))||any(greaterThanEqual(p,spriteOutlineRect.zw)))return vec3(0.);
  return vec3(vec2(texture2D(map,p).a),0.);
}
#endif
void main()`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef USE_MAP
spriteSourceAlpha=diffuseColor.a;
if(spriteOutlineEnabled>.5){
  vec3 layers=spriteAlphasAt(vec2(0.));
  vec2 centers=layers.xy;
  float center=mix(centers.x,centers.y,layers.z);
  spriteSourceAlpha=center*opacity;
  vec2 outer=vec2(0.),inner=vec2(1.);
  vec2 sx=dFdx(vMapUv)*spriteOutlinePixelRatio;
  vec2 sy=dFdy(vMapUv)*spriteOutlinePixelRatio;
  for(int i=0;i<16;i++){
    float angle=float(i)*6.2831853/16.;
    for(int ring=1;ring<=4;ring++){
      vec2 neighbor=spriteAlphasAt((sx*cos(angle)+sy*sin(angle))*float(ring)*.25).xy;
      outer=max(outer,neighbor);inner=min(inner,neighbor);
    }
  }
  // Stroke each drawing before blending: a half-visible pose still has a
  // filled interior, while its contour fades with the drawing.
  vec2 strokes=outer*(1.-centers)+(1.-inner)*centers;
  float stroke=mix(strokes.x,strokes.y,layers.z);
  float alpha=stroke+center*(1.-stroke);
  spriteOutlineMix=stroke/max(alpha,.00001);
  diffuseColor.a=alpha*opacity;
}
#endif`,
      );
      if (color)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          '#include <opaque_fragment>\n#ifdef USE_MAP\ngl_FragColor.rgb=mix(gl_FragColor.rgb,spriteOutlineColor,spriteOutlineMix);\n#endif',
        );
    };
    material.customProgramCacheKey = () => `${key}:sprite-outline-v3:${color}`;
    material.needsUpdate = true;
  }

  update(renderer: WebGLRenderer, mesh: Mesh) {
    const canvas = renderer.domElement,
      width = canvas.clientWidth || canvas.width,
      height = canvas.clientHeight || canvas.height,
      target = renderer.getRenderTarget();
    this.uniforms.spriteOutlineEnabled.value = this.enabled && mesh.renderOrder > -1.7 ? 1 : 0;
    this.uniforms.spriteOutlineViewport.value.set(width, height);
    this.uniforms.spriteOutlinePixelRatio.value = (target?.height ?? canvas.height) / height;
    const positions = this.geometry.getAttribute('position') as BufferAttribute,
      uv = this.geometry.getAttribute('uv') as BufferAttribute;
    if (positions.version === this.positionsVersion && uv.version === this.uvVersion) return;
    this.positionsVersion = positions.version;
    this.uvVersion = uv.version;
    const left = positions.getX(0),
      right = positions.getX(1),
      top = positions.getY(0),
      bottom = positions.getY(2);
    this.uniforms.spriteOutlineCenter.value.set((left + right) / 2, (top + bottom) / 2);
    this.uniforms.spriteOutlineUVPerUnit.value.set(
      (uv.getX(1) - uv.getX(0)) / (right - left),
      (uv.getY(0) - uv.getY(2)) / (top - bottom),
    );
    this.uniforms.spriteOutlineRect.value.set(uv.getX(0), uv.getY(2), uv.getX(1), uv.getY(0));
    this.uniforms.spriteOutlineDepthSlope.value =
      (positions.getZ(0) - positions.getZ(2)) / (top - bottom);
  }
}
