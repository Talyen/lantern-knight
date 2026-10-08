import { OrthographicCamera, Vector3 } from 'three';
import contract from './camera.json';
export const HEADINGS = ['d00', 'd45', 'd90', 'd135', 'd180', 'd225', 'd270', 'd315'] as const;
export function cameraAxes(selected = contract) {
  const a = (selected.azimuthDeg * Math.PI) / 180,
    e = (selected.elevationDeg * Math.PI) / 180;
  const outward = new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)),
    right = new Vector3(Math.cos(a), 0, -Math.sin(a)),
    up = new Vector3().crossVectors(outward, right);
  return { outward, right, up };
}
export function cameraCalibration(selected = contract) {
  const { outward, right, up } = cameraAxes(selected);
  const h = selected.verticalSpan / 2,
    camera = new OrthographicCamera((-h * 16) / 9, (h * 16) / 9, h, -h, 0.1, 100);
  camera.position.copy(outward).multiplyScalar(30);
  camera.lookAt(new Vector3());
  camera.updateMatrixWorld();
  return {
    contract: selected,
    matrixLayout: 'column-major',
    units: 'world metres',
    right: right.toArray(),
    up: up.toArray(),
    outward: outward.toArray(),
    matrixWorld: camera.matrixWorld.toArray(),
    view: camera.matrixWorldInverse.toArray(),
    projection: camera.projectionMatrix.toArray(),
    headings: HEADINGS.map((id, i) => {
      const yaw = (i * Math.PI) / 4,
        v = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      return {
        id,
        yawDeg: i * 45,
        screenVector: [v.dot(right), -v.dot(up)],
        facing: i === 1 ? 'toward camera' : i === 5 ? 'away from camera' : 'oblique',
      };
    }),
  };
}
