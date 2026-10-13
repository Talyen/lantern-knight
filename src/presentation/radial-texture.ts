import { CanvasTexture } from 'three';

export function radialTexture(innerRadius: number, centerAlpha: number, middleAlpha: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!,
    gradient = context.createRadialGradient(32, 32, innerRadius, 32, 32, 32);
  for (const [offset, alpha] of [
    [0, centerAlpha],
    [0.35, middleAlpha],
    [1, 0],
  ] as const)
    gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.generateMipmaps = false;
  return texture;
}
