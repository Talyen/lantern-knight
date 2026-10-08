import * as T from 'three';
import type { PackLease } from '../assets/loader';
import type { WorldVisualDefinition } from '../content/world-art';
import { clearing, pavingIslands } from '../content/graveyard-layout';

// Every static ground detail shares one depth surface. Artwork is sampled at native density;
// there are no soil/border/decal planes to fight for ownership as the camera moves.
export function graveyardGroundMaterial(packs: Map<string, PackLease>, art: WorldVisualDefinition) {
  const materials = packs.get('ink-graveyard-materials')!,
    soil = packs.get('ink-soil')!,
    overlays = packs.get('ink-graveyard-overlays')!;
  const texture = (id: string) => {
    const f = materials.manifest.frames.find((f) => f.id === id)!;
    const t = materials.textures.get(f.page)!;
    if (t.wrapS !== T.RepeatWrapping || t.wrapT !== T.RepeatWrapping) {
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.needsUpdate = true;
    }
    return t;
  };
  const sf = soil.manifest.frames[0]!,
    sp = soil.manifest.pages.find((p) => p.id === sf.page)!;
  if (overlays.manifest.pages.length !== 1)
    throw new Error('ground overlays require one alpha-padded atlas');
  const m = new T.MeshBasicMaterial({
    map: texture('grass'),
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const num = (n: number) => n.toFixed(5);
  const routes = art.paths
    .flatMap((route) =>
      route.points.slice(1).map((b, i) => {
        const a = route.points[i]!,
          w0 = route.widths?.[i] ?? route.width,
          w1 = route.widths?.[i + 1] ?? route.width;
        return `stone=max(stone,routeCoverage(q,vec2(${num(a.x)},${num(a.z)}),vec2(${num(b.x)},${num(b.z)}),${num(w0)},${num(w1)}));`;
      }),
    )
    .join('\n');
  const graves = art.graves
    .map(
      (g) =>
        `{vec2 d=q-vec2(${num(g.x)},${num(g.z)});float ca=cos(${num(g.angle ?? 0)}),sa=sin(${num(g.angle ?? 0)});vec2 uv=vec2(d.x*ca-d.y*sa,d.x*sa+d.y*ca)/vec2(${num(g.width)},${num(g.length)})+.5;if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){vec4 soil=sampleSoil(uv);color=mix(color,soil.rgb,soil.a*${g.age === 'kept' ? '.70' : g.age === 'damaged' ? '.38' : '.20'}*(1.-stone));}}`,
    )
    .join('\n');
  const decals = art.decals
    .filter((p) => p.asset === 'ink-graveyard-overlays')
    .map((p) => {
      const f = overlays.manifest.frames.find((f) => f.id === p.clip)!;
      const page = overlays.manifest.pages[0]!,
        a = p.rotation ?? 0,
        scale = (p.scale ?? 1) * 4;
      return `{vec2 d=q-vec2(${num(p.x)},${num(p.z)});vec2 uv=vec2(d.x*${num(Math.cos(a))}-d.y*${num(Math.sin(a))},d.x*${num(Math.sin(a))}+d.y*${num(Math.cos(a))})/${num(scale)}+.5;${p.mirror ? 'uv.x=1.-uv.x;' : ''}vec2 px=uv*1024.-vec2(${f.trim[0]}.0,${f.trim[1]}.0);if(all(greaterThanEqual(px,vec2(0.)))&&all(lessThan(px,vec2(${f.trim[2]}.0,${f.trim[3]}.0)))){vec2 atlas=(vec2(${f.rect[0]}.0,${f.rect[1]}.0)+px)/vec2(${page.width}.0,${page.height}.0);vec4 detail=texture2D(overlayMap,vec2(atlas.x,1.-atlas.y));color=mix(color,detail.rgb,detail.a);}}`;
    })
    .join('\n');
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      earthMap: { value: texture('earth') },
      pavingMap: { value: texture('paving') },
      apronMap: { value: texture('apron') },
      soilMap: { value: soil.textures.get(sf.page) },
      overlayMap: { value: overlays.textures.get(overlays.manifest.pages[0]!.id) },
    });
    shader.vertexShader = 'varying vec3 terrainWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nterrainWorld=(modelMatrix*vec4(position,1.)).xyz;',
    );
    shader.fragmentShader =
      `uniform sampler2D earthMap,pavingMap,apronMap,soilMap,overlayMap;varying vec3 terrainWorld;
float routeCoverage(vec2 q,vec2 a,vec2 b,float wa,float wb){vec2 d=b-a;float t=clamp(dot(q-a,d)/dot(d,d),0.,1.);float gap=length(q-a-d*t)-mix(wa,wb,t)*.5+(sin(q.x*11.+q.y*7.)+sin(q.x*23.-q.y*17.))*.025;return 1.-smoothstep(-.035,.07,gap);}
vec4 sampleSoil(vec2 uv){vec2 p=uv*vec2(${soil.manifest.asset.canvas[0]}.0,${soil.manifest.asset.canvas[1]}.0)-vec2(${sf.trim[0]}.0,${sf.trim[1]}.0);if(any(lessThan(p,vec2(0.)))||any(greaterThanEqual(p,vec2(${sf.trim[2]}.0,${sf.trim[3]}.0))))return vec4(0.);vec2 atlas=(vec2(${sf.rect[0]}.0,${sf.rect[1]}.0)+p)/vec2(${sp.width}.0,${sp.height}.0);return texture2D(soilMap,vec2(atlas.x,1.-atlas.y));}
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
vec2 q=terrainWorld.xz,terrainUV=vec2(q.x,-q.y)/4.;
float field=(sin(q.x*.43+q.y*.31)+sin(q.x*.19-q.y*.58)*.55)/1.55;
float route=0.;${routes.replaceAll('stone', 'route')}
float clearing=1.-smoothstep(.80,1.12,length((q-vec2(${num(clearing.x)},${num(clearing.z)}))/vec2(${num(clearing.radiusX)},${num(clearing.radiusZ)}))+.04*sin(q.x*2.8-q.y));
float wear=max(route,clearing);
vec3 color=mix(texture2D(map,terrainUV).rgb,texture2D(earthMap,terrainUV).rgb,clamp(.24+wear*.68+field*.07,0.,1.));
// Rest the eye on a broad settled earth plane. Texture becomes stronger under shelter.
color=mix(vec3(.052,.075,.065),color,.44);
color=mix(color,vec3(.093,.078,.059)*(1.+field*.035),clearing*.82);
color=mix(color,vec3(.12,.095,.068)*(1.+field*.035),route*.64*(1.-clearing));
float stone=0.;
// Scattered remnants of paving, deliberately separated by earth, share this depth surface.
${pavingIslands.map((p) => `{vec2 d=q-vec2(${num(p.x)},${num(p.z)});vec2 v=vec2(d.x*cos(${num(p.angle)})-d.y*sin(${num(p.angle)}),d.x*sin(${num(p.angle)})+d.y*cos(${num(p.angle)}));float edge=min(${num(p.width)}/2.-abs(v.x),${num(p.length)}/2.-abs(v.y));stone=max(stone,smoothstep(-.02,.025,edge)*${num(p.opacity)});}`).join('\n')}
color=mix(color,texture2D(apronMap,terrainUV).rgb*vec3(.84,.91,.94),stone*.78);
${graves}\n${decals}
float farFade=smoothstep(18.,40.,max(abs(q.x),abs(q.y)));diffuseColor*=vec4(mix(color,vec3(.025,.043,.039),farFade*.8),1.);
`,
    );
  };
  m.customProgramCacheKey = () =>
    `last-tended-light-ground-v1:${soil.manifest.hash}:${overlays.manifest.hash}:${JSON.stringify(art.decals)}`;
  return m;
}
