import * as T from 'three';
import { outward, right, up } from '../core/camera';
import { resolveClip } from '../assets/schema';
import type { PackLease } from '../assets/loader';
import type { Point } from '../content/world';
import type { SceneSurroundDefinition, SurroundLayer } from '../content/world-visuals';
import { ActorSprite } from './sprite';
import { lightingRigs, type LookSettings } from './lighting-profiles';
import { neutralColor } from './illustrated-lighting';

// The camera translates without rotating. Project camera motion, never actor
// motion, so the background stops when composition reaches its follow limit.
function surroundOffset(target: T.Vector3, anchor: T.Vector3, parallax: number) {
  const delta = target.clone().sub(anchor);
  return right
    .clone()
    .multiplyScalar(delta.dot(right) * (1 - parallax))
    .addScaledVector(up, delta.dot(up) * (1 - parallax));
}

export function groundFootprintGeometry(
  points: readonly Point[],
  height: (x: number, z: number) => number,
) {
  const outline = points.map((p) => new T.Vector2(p.x, p.z));
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      points.flatMap((p) => [p.x, height(p.x, p.z), p.z]),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new T.Float32BufferAttribute(
      points.flatMap((p) => [p.x / 4, -p.z / 4]),
      2,
    ),
  );
  // XZ reverses the screen-space winding used by ShapeUtils.
  geometry.setIndex(
    T.ShapeUtils.triangulateShape(outline, []).flatMap(([a, b, c]) => [a!, c!, b!]),
  );
  geometry.computeVertexNormals();
  return geometry;
}

export function insetGround(points: readonly Point[], inset: number) {
  const center = points.reduce(
    (p, q) => ({ x: p.x + q.x / points.length, z: p.z + q.z / points.length }),
    { x: 0, z: 0 },
  );
  return points.map((p) => {
    const length = Math.hypot(p.x - center.x, p.z - center.z),
      scale = Math.max(0, 1 - inset / length);
    return { x: center.x + (p.x - center.x) * scale, z: center.z + (p.z - center.z) * scale };
  });
}
export function groundRimGeometry(
  points: readonly Point[],
  height: (x: number, z: number) => number,
  inset: number,
) {
  const inner = insetGround(points, inset),
    both = [...inner, ...points],
    indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    indices.push(i, j, i + points.length, j, j + points.length, i + points.length);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      both.flatMap((p) => [p.x, height(p.x, p.z), p.z]),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new T.Float32BufferAttribute(
      both.flatMap((p) => [p.x / 4, -p.z / 4]),
      2,
    ),
  );
  geometry.setAttribute(
    'groundCoverage',
    new T.Float32BufferAttribute(
      both.map((_, i) => (i < points.length ? 1 : 0)),
      1,
    ),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
export function fadeGroundRim(material: T.MeshBasicMaterial) {
  const previous = material.onBeforeCompile.bind(material),
    cacheKey = material.customProgramCacheKey();
  material.transparent = true;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader =
      'attribute float groundCoverage;varying float rimCoverage;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nrimCoverage=groundCoverage;',
    );
    shader.fragmentShader = 'varying float rimCoverage;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      'diffuseColor.a*=rimCoverage;\n#include <alphatest_fragment>',
    );
  };
  material.customProgramCacheKey = () => cacheKey + '-ground-rim-v1';
}

type Band = {
  definition: SurroundLayer;
  sprite: ActorSprite;
  mesh?: T.InstancedMesh<T.BufferGeometry, T.MeshBasicMaterial>;
  capacity: number;
  tint: T.Uniform<T.Color>;
  detail: T.Uniform<number>;
  uv: T.Uniform<T.Vector2>;
  width: number;
  height: number;
  bottom: number;
  centerX: number;
};
export class SceneSurround {
  readonly scene = new T.Scene();
  private bands: Band[] = [];
  private anchor = new T.Vector3();
  private definition: SceneSurroundDefinition | undefined;
  constructor(readonly packs: ReadonlyMap<string, PackLease>) {}
  build(definition: SceneSurroundDefinition | undefined) {
    this.dispose();
    this.definition = definition;
    if (!definition) return;
    this.anchor.set(definition.anchor.x, 0, definition.anchor.z);
    this.scene.background = new T.Color(definition.color);
    for (const layer of definition.layers) {
      const pack = this.packs.get(layer.asset);
      if (!pack) throw new Error(`missing surround art: ${layer.asset}`);
      const clip = resolveClip(pack.manifest, layer.clip, 'd45'),
        frame = pack.manifest.frames.find((f) => f.id === clip.frames[0])!,
        registration = frame.registration ?? pack.manifest.asset;
      const sprite = new ActorSprite(`surround-${layer.clip}`, pack.manifest, pack.textures, clip);
      const band: Band = {
        definition: layer,
        sprite,
        capacity: 0,
        tint: new T.Uniform(new T.Color(layer.tint)),
        detail: new T.Uniform(layer.detail),
        uv: new T.Uniform(new T.Vector2()),
        width: (frame.trim[2] / registration.density) * layer.scale,
        height: (frame.trim[3] / registration.density) * layer.scale,
        bottom:
          ((registration.anchor[1] - frame.trim[1] - frame.trim[3]) / registration.density) *
          layer.scale,
        centerX: 0,
      };
      // Each band is one blended instanced draw, including native soft edges.
      // Mirror UVs instead of using unsupported negative instance scales.
      const material = sprite.material,
        previous = material.onBeforeCompile.bind(material),
        cacheKey = material.customProgramCacheKey();
      material.transparent = true;
      material.alphaTest = 1 / 255;
      material.side = T.FrontSide;
      material.depthTest = false;
      material.depthWrite = false;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        Object.assign(shader.uniforms, {
          surroundTint: band.tint,
          surroundDetail: band.detail,
          surroundUV: band.uv,
        });
        shader.vertexShader =
          'attribute float surroundMirror;uniform vec2 surroundUV;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x=mix(vMapUv.x,surroundUV.x+surroundUV.y-vMapUv.x,surroundMirror);\n#endif',
        );
        shader.fragmentShader =
          'uniform vec3 surroundTint;uniform float surroundDetail;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          '#include <map_fragment>\nfloat surroundTone=step(.055,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));\ndiffuseColor.rgb=surroundTint*(1.0+surroundTone*surroundDetail);',
        );
      };
      material.customProgramCacheKey = () => cacheKey + '-surround-instanced-v1';
      this.bands.push(band);
    }
  }
  private cardMesh(band: Band, count: number, camera: T.OrthographicCamera, order: number) {
    if (band.mesh && count <= band.capacity) return band.mesh;
    band.mesh?.geometry.dispose();
    band.mesh?.dispose();
    band.mesh?.removeFromParent();
    band.sprite.show(band.sprite.animator.frame, new T.Vector3(), camera);
    const geometry = band.sprite.geometry.clone(),
      positions = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv');
    let minX = Infinity,
      maxX = -Infinity,
      minU = Infinity,
      maxU = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      minX = Math.min(minX, positions.getX(i));
      maxX = Math.max(maxX, positions.getX(i));
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
    }
    band.centerX = (minX + maxX) / 2;
    band.uv.value.set(minU, maxU);
    band.capacity = 2 ** Math.ceil(Math.log2(count));
    const mirror = new T.InstancedBufferAttribute(new Float32Array(band.capacity), 1).setUsage(
      T.DynamicDrawUsage,
    );
    geometry.setAttribute('surroundMirror', mirror);
    const mesh = new T.InstancedMesh(geometry, band.sprite.material, band.capacity);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.name = `surround-${order}`;
    mesh.userData.decorative = true;
    mesh.userData.cells = new Map<string, number>();
    this.scene.add(mesh);
    band.mesh = mesh;
    return mesh;
  }
  update(
    camera: T.OrthographicCamera,
    target: T.Vector3,
    settings: LookSettings,
    palette: boolean,
  ) {
    if (!this.definition) return;
    const background = this.scene.background as T.Color;
    background.set(this.definition.color);
    if (!palette) neutralColor(background);
    for (const [order, band] of this.bands.entries()) {
      const d = band.definition,
        origin = this.anchor.clone().add(surroundOffset(target, this.anchor, d.parallax));
      const center = target.clone().sub(origin),
        cx = center.dot(right),
        cy = center.dot(up),
        stepX = band.width * 0.78,
        stepY = band.height * 0.72;
      const firstX = Math.floor((cx + camera.left - band.width * 0.5) / stepX),
        lastX = Math.ceil((cx + camera.right + band.width * 0.5) / stepX);
      const firstY = Math.floor((cy + camera.bottom - d.base - band.height) / stepY),
        lastY = Math.floor((cy + camera.top - d.base) / stepY);
      band.tint.value.set(d.tint);
      if (!settings.baseline && settings.lighting)
        band.tint.value.lerp(new T.Color(lightingRigs[settings.rig].fog), 0.1 * settings.strength);
      if (!palette) neutralColor(band.tint.value);
      band.detail.value = palette ? d.detail : 0;
      const mesh = this.cardMesh(band, (lastX - firstX + 1) * (lastY - firstY + 1), camera, order),
        mirror = mesh.geometry.getAttribute('surroundMirror') as T.InstancedBufferAttribute;
      const cells = mesh.userData.cells as Map<string, number>;
      cells.clear();
      const matrix = new T.Matrix4(),
        foot = new T.Vector3(),
        scale = new T.Vector3(d.scale, d.scale, d.scale);
      let index = 0;
      // Upper rows draw first; lower canopies cover their root seams.
      for (let row = lastY; row >= firstY; row--)
        for (let col = firstX; col <= lastX; col++) {
          const reflected = Math.abs(col + row) % 2;
          foot
            .copy(origin)
            .addScaledVector(
              right,
              col * stepX +
                (Math.abs(row) % 2) * stepX * 0.45 -
                reflected * 2 * band.centerX * d.scale,
            )
            .addScaledVector(up, d.base + row * stepY - band.bottom)
            .addScaledVector(outward, -8 - order);
          mesh.setMatrixAt(index, matrix.compose(foot, camera.quaternion, scale));
          mirror.setX(index, reflected);
          cells.set(`${row}:${col}`, index++);
        }
      mesh.count = index;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      mirror.needsUpdate = true;
    }
  }
  render(renderer: T.WebGLRenderer, camera: T.OrthographicCamera, foreground: T.Scene) {
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.clear();
      if (this.definition) renderer.render(this.scene, camera);
      renderer.clearDepth();
      renderer.render(foreground, camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }
  stats() {
    return {
      layers: this.bands.length,
      tiles: this.bands.reduce((n, b) => n + (b.mesh?.count ?? 0), 0),
    };
  }
  dispose() {
    for (const band of this.bands) {
      band.mesh?.geometry.dispose();
      band.mesh?.dispose();
      band.mesh?.removeFromParent();
      band.sprite.dispose();
    }
    this.bands = [];
    this.scene.clear();
    this.scene.background = null;
    this.definition = undefined;
  }
}
