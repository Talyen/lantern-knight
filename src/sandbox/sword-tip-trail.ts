import * as T from 'three';
import type { Presentation } from '../presentation/scene';
import { registeredSword } from '../presentation/rigid-sword';
import { contract } from '../core/camera';
import type { Simulation } from '../core/simulation';
import { attackDefinition } from '../content/gameplay';

// Centre of the cream/gold stroke in native C / d090 / cel 6 (512 × 448).
// UVs retain the supplied brushwork; only its carrier follows the visible sword.
const sourceY = [
  276, 269, 273, 274, 276, 277, 278, 278, 279, 279, 279, 278, 277, 276, 274, 272, 270, 267, 264,
  261, 256, 250, 244, 237, 231,
];
const segments = sourceY.length - 1;

function visibleBlade(view: Presentation, sim: Simulation, pose?: string) {
  const sprite = view.actorPresentation.actors.get(sim.hero.id)?.sprite,
    sample = sprite?.lightingSample;
  if (!sprite || !sample) return;
  const frame = pose ?? sample.frame.id,
    blend = pose ? undefined : sample.blend;
  const pair =
    view.registration.animation.pairs.find(
      (pair) =>
        pair.asset === sprite.manifest.asset.id &&
        pair.sword &&
        (blend ? pair.from === blend.from && pair.to === blend.to : pair.from === frame),
    ) ??
    view.registration.animation.pairs.find(
      (pair) => pair.asset === sprite.manifest.asset.id && pair.sword && pair.to === frame,
    );
  if (!pair?.sword) return;
  const a = sprite.frameIndex.get(pair.from)!,
    b = sprite.frameIndex.get(pair.to)!;
  const sword = registeredSword(
    pair.sword,
    { ...a, visualOffsetPx: [...pair.offsetA] },
    { ...b, visualOffsetPx: [...pair.offsetB] },
    sprite.stabilized,
  );
  const mix = blend?.mix ?? (frame === pair.from ? 0 : 1),
    x = T.MathUtils.lerp(sword.a[0], sword.b[0], mix),
    y = T.MathUtils.lerp(sword.a[1], sword.b[1], mix),
    angle = Math.atan2(sword.a[3] - sword.a[1], sword.a[2] - sword.a[0]) + sword.rotationRad * mix,
    length = T.MathUtils.lerp(
      Math.hypot(sword.a[2] - sword.a[0], sword.a[3] - sword.a[1]),
      Math.hypot(sword.b[2] - sword.b[0], sword.b[3] - sword.b[1]),
      mix,
    ),
    depth = Math.tan(T.MathUtils.degToRad(contract.elevationDeg));
  sprite.mesh.updateWorldMatrix(true, false);
  const world = (x: number, y: number) => {
    const up = (pair.anchor[1] - y) / pair.density;
    return sprite.mesh.localToWorld(
      new T.Vector3((x - pair.anchor[0]) / pair.density, up, up * depth),
    );
  };
  const hilt = world(x, y),
    tip = world(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
  return {
    tip,
    axis: tip.clone().sub(hilt).normalize(),
    frame,
    time: sprite.animator.time,
  };
}

export class SwordTipTrail {
  private mesh?: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  constructor(
    private view: Presentation,
    private group: T.Group,
  ) {}
  update(sim: Simulation, forward: number) {
    const hero = sim.hero,
      timing = attackDefinition(hero);
    if (hero.state !== 'attack' || hero.attackKind !== 'sweep') {
      this.reset();
      return;
    }
    const blade = visibleBlade(this.view, sim);
    if (!blade) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    const time = blade.time,
      cutoff = Math.max(time - 140, ((timing.windup - 1) * 1000) / 60),
      point = blade.tip.clone().addScaledVector(blade.axis, forward),
      history: T.Vector3[] = [],
      clip = this.view.actorPresentation.actors.get(hero.id)!.sprite.animator.clip;
    let end = 0;
    // Use authored cels, not rendered-frame history: a short cel can fall between refreshes.
    for (let i = 0; i < clip.frames.length; i++) {
      end += clip.durationsMs[i]!;
      if (end > time + 0.0001) break;
      if (end <= cutoff + 0.0001) continue;
      const previous = visibleBlade(this.view, sim, clip.frames[i]);
      if (previous) history.push(previous.tip.clone().addScaledVector(previous.axis, forward));
    }
    if (!history.length || history.at(-1)!.distanceToSquared(point) > 0.000025) history.push(point);
    if (
      history.length < 2 ||
      time < (timing.windup * 1000) / 60 - 17 ||
      time >= (timing.activeEnd * 1000) / 60 + 50
    ) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    if (!this.mesh) {
      const pack = this.view.packs.get('library-sword_finisher_03');
      if (!pack) return;
      const clip = pack.manifest.asset.clips.sword_finisher_03__d090!.d45!,
        frame = pack.manifest.frames.find((frame) => frame.id === clip.frames[6])!,
        geometry = new T.BufferGeometry(),
        uv = new Float32Array((segments + 1) * 4),
        indices: number[] = [];
      for (let i = 0; i <= segments; i++) {
        for (let side = 0; side < 2; side++) {
          uv[i * 4 + side * 2] = (160 + i * 10) / 512;
          uv[i * 4 + side * 2 + 1] = 1 - (sourceY[i]! + (side ? 30 : -30)) / 448;
        }
        if (i < segments)
          indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      geometry.setAttribute(
        'position',
        new T.BufferAttribute(new Float32Array((segments + 1) * 6), 3),
      );
      geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geometry.setIndex(indices);
      this.mesh = new T.Mesh(
        geometry,
        new T.MeshBasicMaterial({
          map: pack.textures.get(frame.page),
          transparent: true,
          depthWrite: false,
          depthTest: true,
          side: T.DoubleSide,
          toneMapped: false,
          alphaTest: 0.01,
        }),
      );
      this.mesh.name = 'sweep-sword-tip-trail';
      this.mesh.frustumCulled = false;
      this.group.add(this.mesh);
    }
    const mesh = this.mesh,
      curve = new T.CatmullRomCurve3(history),
      positions = mesh.geometry.getAttribute('position') as T.BufferAttribute,
      outward = new T.Vector3(0, 0, 1).applyQuaternion(this.view.camera.quaternion);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments,
        centre = curve.getPoint(t),
        normal = curve.getTangent(t).cross(outward).normalize();
      for (let side = 0; side < 2; side++) {
        const point = centre
          .clone()
          .addScaledVector(normal, side ? 0.35 : -0.35)
          .addScaledVector(outward, 0.008);
        positions.setXYZ(i * 2 + side, point.x, point.y, point.z);
      }
    }
    positions.needsUpdate = true;
    mesh.material.opacity =
      1 - T.MathUtils.clamp((time - (timing.activeEnd * 1000) / 60) / 50, 0, 1);
    mesh.visible = true;
    mesh.userData = {
      swordFrame: blade.frame,
      tip: blade.tip.toArray(),
      lead: point.toArray(),
      forward,
    };
  }
  reset() {
    if (this.mesh) this.mesh.visible = false;
  }
  dispose() {
    this.reset();
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
  }
}
