import * as T from 'three';
import type { GamePresentation } from './game-scene';
export function captureArtDiagnostics(p: GamePresentation) {
  const r = p.renderer,
    size = r.getDrawingBufferSize(new T.Vector2()),
    target = new T.WebGLRenderTarget(size.x, size.y, {
      type: T.FloatType,
      depthBuffer: true,
      minFilter: T.NearestFilter,
      magFilter: T.NearestFilter,
    });
  const sprites = p.roomPresentation.inkRoom?.sprites ?? [],
    byMesh = new Map(sprites.map((s) => [s.mesh, s])),
    edges = new Set(sprites.flatMap((s) => (s.edgeMesh ? [s.edgeMesh] : []))),
    hidden: T.Object3D[] = [],
    restore: { mesh: T.Mesh; material: T.Material | T.Material[] }[] = [],
    materials: T.Material[] = [],
    owners: string[] = ['background'],
    index = new Map<string, number>();
  const previousTarget = r.getRenderTarget(),
    clear = r.getClearColor(new T.Color()),
    clearAlpha = r.getClearAlpha(),
    shadow = r.shadowMap.enabled;
  const idPixels = new Float32Array(size.x * size.y * 4),
    depthPixels = new Float32Array(size.x * size.y * 4);
  try {
    p.scene.traverseVisible((o) => {
      if (o === p.scene || o === p.roomPresentation.room) return;
      if (!p.roomPresentation.room.getObjectById(o.id) || edges.has(o as T.Mesh)) {
        hidden.push(o);
        return;
      }
      if (!(o instanceof T.Mesh)) return;
      const sprite = byMesh.get(o),
        source = Array.isArray(o.material) ? o.material[0]! : o.material;
      if (
        sprite?.manifest.asset.type === 'effect' ||
        [...p.actorPresentation.actors.values()].some((v) =>
          [v.sprite.mesh, v.shadow, v.ring].includes(o),
        ) ||
        source instanceof T.ShadowMaterial ||
        (source.transparent && !sprite && !o.userData.stableReveal)
      ) {
        hidden.push(o);
        return;
      }
      const owner =
        sprite?.id ?? (o.renderOrder <= -1.7 ? 'ground' : (o.userData.id ?? `part-${o.id}`));
      let n = index.get(owner);
      if (!n) {
        n = owners.length;
        owners.push(owner);
        index.set(owner, n);
      }
      const m = new T.MeshBasicMaterial({
        map: source instanceof T.MeshBasicMaterial ? source.map : null,
        alphaTest: source instanceof T.MeshBasicMaterial && source.map ? 0.7 : 0,
        depthTest: true,
        depthWrite: true,
        side: source.side,
        toneMapped: false,
      });
      m.userData.owner = n;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.diagnosticMode = { value: 0 };
        shader.uniforms.diagnosticOwner = { value: n };
        shader.fragmentShader =
          'uniform float diagnosticMode,diagnosticOwner;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          'outgoingLight=diagnosticMode>.5?vec3(gl_FragCoord.z,0.,0.):vec3(diagnosticOwner,0.,0.);\n#include <opaque_fragment>',
        );
        m.userData.uniforms = shader.uniforms;
      };
      m.customProgramCacheKey = () => `art-diagnostic-${n}`;
      restore.push({ mesh: o, material: o.material });
      o.material = m;
      materials.push(m);
    });
    for (const o of hidden) o.visible = false;
    r.shadowMap.enabled = false;
    r.setRenderTarget(target);
    r.setClearColor(0, 1);
    r.clear();
    r.render(p.scene, p.camera);
    r.readRenderTargetPixels(target, 0, 0, size.x, size.y, idPixels);
    for (const m of materials)
      if (m.userData.uniforms) (m.userData.uniforms.diagnosticMode as T.Uniform<number>).value = 1;
    r.clear();
    r.render(p.scene, p.camera);
    r.readRenderTargetPixels(target, 0, 0, size.x, size.y, depthPixels);
    const ids = new Uint16Array(size.x * size.y),
      depth = new Float32Array(size.x * size.y);
    for (let i = 0; i < ids.length; i++) {
      ids[i] = Math.round(idPixels[i * 4]!);
      depth[i] = depthPixels[i * 4]!;
    }
    return {
      width: size.x,
      height: size.y,
      ids,
      depth,
      owners,
      viewProjection: new T.Matrix4()
        .multiplyMatrices(p.camera.projectionMatrix, p.camera.matrixWorldInverse)
        .toArray(),
    };
  } finally {
    for (const { mesh, material } of restore) mesh.material = material;
    for (const o of hidden) o.visible = true;
    for (const m of materials) m.dispose();
    target.dispose();
    r.shadowMap.enabled = shadow;
    r.setRenderTarget(previousTarget);
    r.setClearColor(clear, clearAlpha);
  }
}
