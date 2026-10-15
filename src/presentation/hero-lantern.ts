import { Vector3 } from 'three';
import swordSockets from '../content/hero-sword-sockets.json';
import sockets from '../content/hero-lantern-sockets.json';
import { cameraContract as contract } from '../assets/camera-contract';
import type { Frame } from '../assets/schema';
import type { ActorSprite } from './sprite';

// Reviewed native drawing coordinates; asset preparation cannot overwrite them.
// A changed hero handoff needs new socket registration, rather than stale offsets.
export function heroLanternPosition(sprite: ActorSprite, target: Vector3) {
  const sample = sprite.lightingSample;
  if (!sample || sprite.manifest.asset.contentVersion !== 'hero-directed-20261007-v03')
    return false;
  const point = (frame: Frame) => {
    const socket = frame.attachments.lantern ?? sockets[frame.id as keyof typeof sockets];
    if (!socket) return undefined;
    const registration = frame.registration ?? sprite.manifest.asset,
      offset = sprite.stabilized ? (frame.visualOffsetPx ?? [0, 0]) : [0, 0],
      x = (socket[0]! - registration.anchor[0] + offset[0]!) / registration.density,
      y = (registration.anchor[1] - socket[1]! - offset[1]!) / registration.density;
    return new Vector3(x, y, y * Math.tan((contract.elevationDeg * Math.PI) / 180));
  };
  const from = point(sample.frame);
  if (!from) return false;
  if (sample.next && sample.blend) {
    const next = point(sample.next);
    if (next) from.lerp(next, sample.blend.mix);
  }
  sprite.mesh.updateWorldMatrix(true, false);
  target.copy(from).applyMatrix4(sprite.mesh.matrixWorld);
  return true;
}

// Existing reviewed blade endpoints, copied from authoring/hero-motion.json.
// These sockets share the same native drawing coordinates as the lantern sockets.
export function heroSwordPosition(sprite: ActorSprite, base: Vector3, tip: Vector3) {
  const sample = sprite.lightingSample;
  if (!sample || sprite.manifest.asset.contentVersion !== 'hero-directed-20261007-v03')
    return false;
  const points = (frame: Frame) => {
    const line = swordSockets[frame.id as keyof typeof swordSockets];
    if (!line) return;
    const registration = frame.registration ?? sprite.manifest.asset;
    const offset = sprite.stabilized ? (frame.visualOffsetPx ?? [0, 0]) : [0, 0];
    return [0, 2].map((i) => {
      const x = (line[i]! - registration.anchor[0] + offset[0]!) / registration.density;
      const y = (registration.anchor[1] - line[i + 1]! - offset[1]!) / registration.density;
      return new Vector3(x, y, y * Math.tan((contract.elevationDeg * Math.PI) / 180));
    });
  };
  const from = points(sample.frame);
  if (!from) return false;
  if (sample.next && sample.blend) {
    const next = points(sample.next);
    if (next) for (let i = 0; i < 2; i++) from[i]!.lerp(next[i]!, sample.blend.mix);
  }
  sprite.mesh.updateWorldMatrix(true, false);
  base.copy(from[0]!).applyMatrix4(sprite.mesh.matrixWorld);
  tip.copy(from[1]!).applyMatrix4(sprite.mesh.matrixWorld);
  return true;
}
