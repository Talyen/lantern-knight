import { Vector3 } from 'three';
import sockets from '../content/hero-lantern-sockets.json';
import { contract } from '../core/camera';
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
