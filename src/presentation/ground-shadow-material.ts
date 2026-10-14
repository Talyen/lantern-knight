import * as T from 'three';

/** Attenuate the painted surface; colored alpha overlays can brighten its black ink. */
export function multiplyGroundShadow<M extends T.MeshBasicMaterial | T.ShadowMaterial>(
  material: M,
) {
  material.blending = T.CustomBlending;
  material.blendSrc = T.ZeroFactor;
  material.blendDst = T.SrcColorFactor;
  material.blendSrcAlpha = T.ZeroFactor;
  material.blendDstAlpha = T.OneFactor;
  const previous = material.onBeforeCompile.bind(material),
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      'gl_FragColor=vec4(mix(vec3(1.0),gl_FragColor.rgb,gl_FragColor.a),1.0);\n#include <colorspace_fragment>',
    );
  };
  material.customProgramCacheKey = () => key + ':ground-shadow-multiply-v1';
  material.needsUpdate = true;
  return material;
}
