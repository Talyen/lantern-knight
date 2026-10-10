import * as T from 'three';
import { ActorSprite } from './sprite';
import { resolveClip } from '../assets/schema';
import { frameAt, clipDuration } from '../core/animation';
import { right, up } from '../core/camera';
import type { AssetPack } from '../assets/loader';
import type { Bounds } from '../content/world';
import { normalizeWeather, type WeatherState } from '../content/visual-effects';
import {
  RainSchedule,
  rainPathSheltered,
  RAIN_SLOTS,
  RAIN_FALL,
  RAIN_SPLASH,
  RAIN_RIPPLE,
} from './rain-events';
type RainSurface = {
  bounds: Bounds;
  shelters: readonly Bounds[];
  height: (x: number, z: number) => number;
  puddle?: (x: number, z: number) => boolean;
};
export class IllustratedRain {
  readonly group = new T.Group();
  private geometry = new T.PlaneGeometry(0.032, 0.22);
  private material = new T.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    vertexShader:
      'varying vec2 vUV;void main(){vUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:
      'varying vec2 vUV;void main(){float edge=1.-smoothstep(.32,.5,abs(vUV.x-.5));float tip=smoothstep(0.,.12,vUV.y)*smoothstep(0.,.12,1.-vUV.y);vec3 c=mix(vec3(.16,.24,.25),vec3(.60,.70,.68),1.-smoothstep(.10,.3,abs(vUV.x-.5)));gl_FragColor=vec4(c,edge*tip*.65);}',
  });
  private slots: { drop: T.Mesh; splash: ActorSprite; ripple: ActorSprite }[] = [];
  private origin = 0;
  private last = -1;
  private signature = '';
  private visibleDrops = 0;
  private impacts: { x: number; z: number; age: number }[] = [];
  private schedule: RainSchedule;
  constructor(packs: ReadonlyMap<string, AssetPack>, seed = 903) {
    this.schedule = new RainSchedule(seed);
    for (let i = 0; i < RAIN_SLOTS; i++) {
      const sprite = (asset: string) => {
        const p = packs.get(asset)!;
        if (!p) throw new Error(`weather pack unavailable: ${asset}`);
        const s = new ActorSprite(
          `rain-${asset}-${i}`,
          p.manifest,
          p.textures,
          resolveClip(p.manifest, 'show', 'd45'),
        );
        s.mesh.userData.decorative = true;
        this.group.add(s.mesh);
        return s;
      };
      const drop = new T.Mesh(this.geometry, this.material);
      drop.userData.decorative = true;
      this.group.add(drop);
      this.slots.push({ drop, splash: sprite('fx-splash'), ripple: sprite('fx-ripple') });
    }
    this.group.visible = false;
  }
  reset() {
    this.signature = '';
    this.last = -1;
    this.origin = 0;
    this.impacts = [];
    this.visibleDrops = 0;
    this.group.visible = false;
    this.schedule.reset();
  }
  update(
    time: number,
    state: WeatherState,
    enabled: boolean,
    camera: T.OrthographicCamera,
    surface: RainSurface,
  ) {
    const weather = normalizeWeather(state),
      signature = JSON.stringify([weather.rain > 0, enabled, surface.bounds, surface.shelters]);
    if (time < this.last || signature !== this.signature) {
      this.origin = time;
      this.signature = signature;
      this.schedule.reset();
    }
    this.last = time;
    this.group.visible = enabled && weather.rain > 0;
    this.impacts = [];
    this.visibleDrops = 0;
    if (!this.group.visible) return;
    for (const [i, slot] of this.slots.entries()) {
      const e = this.schedule.sample(time - this.origin, i, surface.bounds, weather),
        allowed = e.active && !rainPathSheltered(e.startX, e.startZ, e.x, e.z, surface.shelters),
        ground = surface.height(e.x, e.z);
      slot.drop.visible = allowed && e.age < RAIN_FALL;
      slot.splash.mesh.visible = allowed && e.splashAge >= 0 && e.splashAge < RAIN_SPLASH;
      slot.ripple.mesh.visible =
        allowed && !!surface.puddle?.(e.x, e.z) && e.splashAge >= 0.08 && e.splashAge < RAIN_RIPPLE;
      if (slot.drop.visible) {
        const q = e.age / RAIN_FALL;
        slot.drop.position.set(
          T.MathUtils.lerp(e.startX, e.x, q),
          ground + e.height * (1 - q) + 0.11,
          T.MathUtils.lerp(e.startZ, e.z, q),
        );
        slot.drop.quaternion.copy(camera.quaternion);
        const direction = new T.Vector3(e.x - e.startX, -e.height, e.z - e.startZ);
        slot.drop.rotateZ(-Math.atan2(direction.dot(right), direction.dot(up)));
        this.visibleDrops++;
      }
      const foot = new T.Vector3(e.x, ground + 0.012, e.z);
      for (const [s, age] of [
        [slot.splash, e.splashAge],
        [slot.ripple, e.splashAge - 0.08],
      ] as const)
        if (s.mesh.visible) {
          const clip = s.animator.clip;
          s.show(
            frameAt(clip, Math.min(clipDuration(clip) - 0.001, Math.max(0, age * 1000))),
            foot,
            camera,
          );
          s.mesh.scale.setScalar(s === slot.splash ? 0.5 : 0.65);
        }
      if (slot.splash.mesh.visible) this.impacts.push({ x: e.x, z: e.z, age: e.splashAge });
    }
  }
  stats() {
    return {
      visible: this.group.visible,
      drops: this.visibleDrops,
      impacts: this.impacts.map((p) => ({ ...p })),
      slots: this.slots.length,
    };
  }
  dispose() {
    for (const s of this.slots) {
      s.splash.dispose();
      s.ripple.dispose();
    }
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
