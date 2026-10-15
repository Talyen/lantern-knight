import * as T from 'three';
import type { ActorSprite } from './sprite';
import { outward, right, up } from './camera';

const cameraRotation = new T.Quaternion().setFromRotationMatrix(
  new T.Matrix4().makeBasis(right, up, outward),
);
const upright = new T.Quaternion().setFromUnitVectors(
  new T.Vector3(0, 0, 1),
  new T.Vector3(outward.x, 0, outward.z).normalize(),
);
const correction = upright.clone().multiply(cameraRotation.clone().invert());
const poseRotation = new T.Quaternion();

// Painted cutouts already counter the camera lean in their vertex geometry.
// Projected-world drawings retain a flat carrier, so only those need standing
// shadow poses. Receivers use the identical pose to avoid self-shadow offsets.
export function silhouetteQuaternion(sprite: ActorSprite, target: T.Quaternion) {
  const projection = sprite.manifest.asset.projection;
  return projection === 'projected-world'
    ? target.copy(correction).multiply(sprite.mesh.quaternion)
    : target.copy(sprite.mesh.quaternion);
}
export function silhouetteMatrix(sprite: ActorSprite, target: T.Matrix4) {
  return target.compose(
    sprite.mesh.position,
    silhouetteQuaternion(sprite, poseRotation),
    sprite.mesh.scale,
  );
}
