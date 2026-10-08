import * as T from 'three';
import type { PackLease } from '../assets/loader';
import type { WorldVisualDefinition, SiteWall } from '../content/world-art';
import type { AreaDefinition } from '../content/world';
import { heightAt } from '../content/world';
import type { OcclusionFades } from './occlusion-fades';

export class CryptArchitecture {
  readonly parts: T.Mesh[] = [];
  readonly owned: { dispose(): void }[] = [];
  textureBytes = 0;
  private textures = new Map<string, T.Texture>();
  constructor(
    private area: AreaDefinition,
    private art: WorldVisualDefinition,
    private packs: Map<string, PackLease>,
    private room: T.Group,
    private fades: OcclusionFades,
  ) {}
  texture(id: string) {
    let t = this.textures.get(id);
    if (t) return t;
    const p = this.packs.get(id)!;
    // Mips are safe only for an entire standalone material page, never packed cutouts.
    const f = p.manifest.frames[0]!,
      page = p.manifest.pages.find((v) => v.id === f.page)!;
    if (
      p.manifest.asset.type !== 'material' ||
      f.rect.join() !== [0, 0, page.width, page.height].join()
    )
      throw new Error(`repeatable surface must own its complete page: ${id}`);
    t = page.mipmaps ? p.textures.get(f.page)! : p.textures.get(f.page)!.clone();
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.magFilter = T.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    this.textures.set(id, t);
    if (!page.mipmaps) {
      this.owned.push(t);
      this.textureBytes += Math.ceil((page.rgbaBytes * 4) / 3);
    }
    return t;
  }
  floorMaterial() {
    const m = new T.MeshBasicMaterial({
      map: this.texture(this.art.floor),
      depthWrite: false,
      toneMapped: false,
    });
    m.onBeforeCompile = (s) => {
      s.vertexShader = 'varying vec3 cryptWorld;\n' + s.vertexShader;
      s.vertexShader = s.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ncryptWorld=(modelMatrix*vec4(position,1.)).xyz;',
      );
      s.fragmentShader = 'varying vec3 cryptWorld;\n' + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace(
        '#include <map_fragment>',
        `
    vec2 q=cryptWorld.xz;vec3 stone=texture2D(map,vec2(q.x,-q.y)/4.).rgb;stone=mix(stone,vec3(.19,.21,.23),.35);
    float side=smoothstep(3.1,3.4,abs(q.x));
    float sanctuary=(1.-smoothstep(2.63,2.67,abs(q.x)))*(1.-smoothstep(-5.65,-5.60,q.y));
    vec3 color=stone*mix(vec3(.61,.66,.72),vec3(.48,.55,.64),side);
    color=mix(color,mix(stone,vec3(.52,.49,.41),.55),sanctuary);
    float edge=min(2.65-abs(q.x),min(q.y+8.75,-5.62-q.y));
    float border=step(.02,edge)*(1.-step(.10,edge));
    border*=1.-step(.18,abs(q.y+6.15))*step(2.4,abs(q.x));
    color=mix(color,vec3(.23,.27,.29),border);
    // One crisp daylight shape belongs to the breach, separate from candle pools.
    float breach=step(3.25,q.x)*step(q.x,5.8)*step(-1.9,q.y)*step(q.y,.9-(5.8-q.x)*.55);
    color=mix(color,color*vec3(1.10,1.18,1.26),breach*.5);
    float boundary=min(6.-abs(q.x),9.-abs(q.y));float roomMask=smoothstep(-.01,.01,boundary);
    color*=mix(.82,1.,smoothstep(.1,.65,boundary));
    diffuseColor*=vec4(mix(vec3(.008,.012,.017),color,roomMask),1.);
   `,
      );
    };
    m.customProgramCacheKey = () => 'chapel-ground-v2';
    return m;
  }
  private material(tint: number) {
    const m = new T.MeshBasicMaterial({
      map: this.texture('ink-masonry'),
      color: tint,
      side: T.DoubleSide,
      toneMapped: false,
    });
    this.owned.push(m);
    return m;
  }
  private mesh(id: string, g: T.BufferGeometry, m: T.MeshBasicMaterial, role: string) {
    const mesh = new T.Mesh(g, m);
    mesh.userData.artPart = { id, role };
    this.parts.push(mesh);
    this.room.add(mesh);
    this.owned.push(g);
    return mesh;
  }
  build() {
    const face = this.material(0xb3c0c9),
      cap = this.material(0xd2d4c8);
    for (const w of this.art.walls) {
      const dx = w.to.x - w.from.x,
        dz = w.to.z - w.from.z,
        length = Math.hypot(dx, dz),
        y = heightAt(this.area, w.from.x, w.from.z);
      const normal =
        w.id === 'crypt-west'
          ? new T.Vector3(1, 0, 0)
          : w.id === 'crypt-rear'
            ? new T.Vector3(0, 0, 1)
            : w.id.startsWith('crypt-east')
              ? new T.Vector3(-1, 0, 0)
              : new T.Vector3(0, 0, -1);
      const center = new T.Vector3(
        (w.from.x + w.to.x) / 2,
        y + w.height / 2,
        (w.from.z + w.to.z) / 2,
      ).addScaledVector(normal, w.thickness / 2);
      const g = new T.PlaneGeometry(length, w.height),
        uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, (uv.getX(i) * length) / 2.4, (uv.getY(i) * w.height) / 1.2);
      const normals = g.getAttribute('normal'),
        yaw = Math.atan2(-dz, dx);
      if (new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).dot(normal) < 0)
        for (let i = 0; i < normals.count; i++) normals.setZ(i, -1);
      const wallMaterial = face.clone();
      if (w.id === 'crypt-rear') {
        wallMaterial.onBeforeCompile = (s) => {
          s.vertexShader = 'varying vec2 chapelWindow;\n' + s.vertexShader;
          s.vertexShader = s.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nchapelWindow=position.xy;',
          );
          s.fragmentShader = 'varying vec2 chapelWindow;\n' + s.fragmentShader;
          s.fragmentShader = s.fragmentShader.replace(
            '#include <alphatest_fragment>',
            '#include <alphatest_fragment>\nfloat windowY=chapelWindow.y+2.1;if(abs(chapelWindow.x)<.55&&windowY>.98&&windowY<3.79-abs(chapelWindow.x)*.85)discard;',
          );
        };
        wallMaterial.customProgramCacheKey = () => 'chapel-window-aperture-v1';
      }
      const f = this.mesh(`${w.id}-face`, g, wallMaterial, 'wall-face');
      this.owned.push(f.material);
      f.position.copy(center);
      f.rotation.y = Math.atan2(-dz, dx);
      f.userData.siteWall = w.id;
      f.userData.noCastShadow = !!w.fade;
      f.userData.artPart.assembly = w.assembly;
      const lengthCap = length - w.thickness,
        topGeo = new T.PlaneGeometry(lengthCap, w.thickness),
        topUV = topGeo.getAttribute('uv');
      for (let i = 0; i < topUV.count; i++)
        topUV.setXY(i, (topUV.getX(i) * lengthCap) / 2.4, (topUV.getY(i) * w.thickness) / 1.2);
      const top = this.mesh(`${w.id}-cap`, topGeo, cap.clone(), 'wall-cap');
      this.owned.push(top.material);
      top.position.set((w.from.x + w.to.x) / 2, y + w.height, (w.from.z + w.to.z) / 2);
      top.rotation.set(-Math.PI / 2, 0, Math.atan2(-dz, dx));
      top.userData.artPart.assembly = w.assembly;
      top.userData.noCastShadow = !!w.fade;
      // Caps stop short of junctions; one horizontal plate owns each shared endpoint.
      if (w.fade) {
        this.fades.add(f, w.assembly, w);
        this.fades.add(top, w.assembly, w);
      }
    }
    // A jagged wall shoulder makes the daylight opening legible in the cutaway.
    const shoulderGeometry = new T.BufferGeometry();
    shoulderGeometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(
        [5.81, 3.2, -2.15, 5.81, 1.8, -1.35, 5.81, 0.56, -2.15, 5.81, 0.56, -1.35],
        3,
      ),
    );
    shoulderGeometry.setAttribute(
      'uv',
      new T.Float32BufferAttribute([0, 2.2, 0.66, 1.03, 0, 0, 0.66, 0], 2),
    );
    shoulderGeometry.setIndex([0, 2, 1, 2, 3, 1]);
    shoulderGeometry.computeVertexNormals();
    const breachWall = this.art.walls.find((w) => w.id === 'crypt-east-1')!;
    const shoulder = this.mesh(
      'chapel-breach-shoulder',
      shoulderGeometry,
      face.clone(),
      'wall-face',
    );
    this.owned.push(shoulder.material);
    shoulder.userData.noCastShadow = true;
    shoulder.userData.artPart.assembly = 'crypt-east-bay-1';
    this.fades.add(shoulder, 'crypt-east-bay-1', breachWall);
    for (const [id, vertices, role] of [
      ['cap', [5.81, 3.2, -2.15, 6.19, 3.2, -2.15, 5.81, 1.8, -1.35, 6.19, 1.8, -1.35], 'wall-cap'],
      [
        'end',
        [5.81, 1.8, -1.35, 6.19, 1.8, -1.35, 5.81, 0.56, -1.35, 6.19, 0.56, -1.35],
        'wall-face',
      ],
    ] as const) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 0.32, 1, 0, 0, 0.32, 0], 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      g.computeVertexNormals();
      const m = this.mesh(`chapel-breach-${id}`, g, cap.clone(), role);
      this.owned.push(m.material);
      m.userData.noCastShadow = true;
      m.userData.artPart.assembly = 'crypt-east-bay-1';
      this.fades.add(m, 'crypt-east-bay-1', breachWall);
    }

    const shaftGeometry = new T.BufferGeometry();
    shaftGeometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(
        [5.79, 3.15, -1.8, 5.79, 2.6, -0.3, 3.3, 0.34, -1.9, 4.25, 0.34, -2.0],
        3,
      ),
    );
    shaftGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    const shaftMaterial = new T.MeshBasicMaterial({
      color: 0xc2d9e8,
      transparent: true,
      opacity: 0.055,
      side: T.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      blending: T.AdditiveBlending,
    });
    const shaft = new T.Mesh(shaftGeometry, shaftMaterial);
    shaft.userData.decorative = true;
    shaft.userData.noCastShadow = true;
    this.room.add(shaft);
    this.owned.push(shaftGeometry, shaftMaterial);
    const corners = new Map<string, { x: number; z: number; height: number; wall: SiteWall }>();
    for (const w of this.art.walls)
      for (const v of [w.from, w.to]) {
        const key = `${v.x}:${v.z}`,
          old = corners.get(key);
        if (!old || old.height < w.height) corners.set(key, { ...v, height: w.height, wall: w });
      }
    for (const [key, c] of corners) {
      const g = new T.PlaneGeometry(c.wall.thickness, c.wall.thickness),
        uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, (uv.getX(i) * c.wall.thickness) / 2.4, (uv.getY(i) * c.wall.thickness) / 1.2);
      const m = this.mesh(`crypt-junction-${key}`, g, cap.clone(), 'wall-cap');
      this.owned.push(m.material);
      m.rotation.x = -Math.PI / 2;
      m.position.set(c.x, heightAt(this.area, c.x, c.z) + c.height, c.z);
      if (c.wall.fade) this.fades.add(m, c.wall.assembly, c.wall);
    }
  }
  dispose() {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.textures.clear();
    this.parts.length = 0;
  }
}
