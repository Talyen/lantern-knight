export const puddles = [
  [
    [0.45, 1.42],
    [0.7, 1.14],
    [1.34, 1.05],
    [2.25, 1.26],
    [2.5, 1.7],
    [2.07, 2.02],
    [1.52, 2.14],
    [0.78, 1.89],
  ],
  [
    [-1.12, -1.71],
    [-0.85, -2.01],
    [-0.15, -2.07],
    [0.34, -1.72],
    [0.17, -1.44],
    [-0.55, -1.28],
  ],
  [
    [3.02, -2.75],
    [3.36, -3.24],
    [3.92, -3.12],
    [4.33, -2.61],
    [4.2, -2.05],
    [3.7, -1.8],
    [3.18, -2.12],
  ],
] as const;
export function inPuddle(x: number, z: number) {
  return puddles.some((p) => {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i]!,
        b = p[j]!;
      if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside;
    }
    return inside;
  });
}
export function puddleGLSL() {
  return `float ponds(vec2 p){float coverage=0.;${puddles
    .map(
      (p) =>
        `{bool inside=false;float gap=1000.;${p
          .map((a, i) => {
            const b = p[(i + 1) % p.length]!;
            return `{vec2 a=vec2(${a[0].toFixed(4)},${a[1].toFixed(4)}),b=vec2(${b[0].toFixed(4)},${b[1].toFixed(4)}),d=b-a;gap=min(gap,length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.,1.)));if((a.y>p.y)!=(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}`;
          })
          .join('')}coverage=max(coverage,smoothstep(-.04,.05,inside?gap:-gap));}`,
    )
    .join('')}return coverage;}`;
}
