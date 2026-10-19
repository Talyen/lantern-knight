import { Matrix4, Quaternion, Vector2, Vector3, type OrthographicCamera } from 'three';

/** Translation-only shutter for the fixed orthographic camera; never retains color history. */
export class CameraMotionBlur {
  private previous = new Vector3();
  private rotation = new Quaternion();
  private projection = new Matrix4();
  private valid = false;
  private point = new Vector3();
  private current = new Vector3();
  private offset = new Vector2();

  reset() {
    this.valid = false;
  }

  update(camera: OrthographicCamera, ms: number, enabled: boolean): Vector2 {
    this.offset.set(0, 0);
    const continuous =
      this.valid &&
      enabled &&
      ms > 0 &&
      ms < 100 &&
      this.rotation.angleTo(camera.quaternion) < 0.0001 &&
      this.projection.equals(camera.projectionMatrix);
    if (continuous) {
      this.point.copy(this.previous).project(camera);
      this.current.copy(camera.position).project(camera);
      this.offset.set(this.point.x - this.current.x, this.point.y - this.current.y);
      // NDC -> UV, with an 8.3 ms shutter independent of the display refresh rate.
      this.offset.multiplyScalar(0.5);
      if (this.offset.length() > 0.1) this.offset.set(0, 0);
      else this.offset.multiplyScalar(Math.min(1, 1000 / 120 / ms)).clampLength(0, 0.008);
    }
    this.previous.copy(camera.position);
    this.rotation.copy(camera.quaternion);
    this.projection.copy(camera.projectionMatrix);
    this.valid = enabled;
    return this.offset;
  }
}
