import * as T from 'three';
import { right, up, outward } from './camera';
import { cameraContract } from '../assets/camera-contract';
import { heroLanternPosition, heroSwordPosition } from './hero-lantern';
import { flareLightEnvelope } from '../content/ability-effects';
import { tuning } from '../content/gameplay';
import { ActorSprite } from './sprite';
import { combatFeedback as settings, combatEffectAssets } from '../content/combat-feedback';
import {
  defaultSweepTiming,
  sweepEffectTiming,
  sweepEffectPhase,
  type SweepTiming,
} from '../content/sweep-timing';
import { attackDefinition } from '../content/gameplay';
import { selectDirection, selectAuthoredDirection } from '../content/headings';
import { clipDuration } from '../core/animation';
import type { EventHub, GameplayEvent } from '../core/events';
import type { SimulationView } from '../core/simulation-view';
import type { AssetPack } from '../assets/loader';

type ActiveEffect = {
  sprite: ActorSprite;
  start: number;
  duration: number;
  position: T.Vector3;
  reverse: boolean;
  scale: number;
  kind: 'sweep' | 'contact' | 'flare' | 'lunge' | 'dodge';
  rotation?: number;
  action?: number;
  sweepTiming?: SweepTiming;
};
export class CombatFeedback {
  readonly group = new T.Group();
  sweepEnabled = true;
  dodgeTreatment: 'dust' | 'leaves' | 'combined' = 'combined';
  readonly flareLight = { position: new T.Vector3(), power: 0, range: 7 };
  private pulse: { tick: number; generation: number; action: number } | undefined;
  private active: ActiveEffect[] = [];
  private prepared = new Map<string, ActorSprite>();
  private disposed = false;
  private pending: (GameplayEvent & { kind: 'damage' })[] = [];
  private generation = -1;
  private castTag = '';
  private unsubscribe: () => void;
  constructor(
    private packs: ReadonlyMap<string, AssetPack>,
    private camera: T.OrthographicCamera,
    events: EventHub,
  ) {
    this.unsubscribe = events.subscribe((event) => {
      if (event.kind === 'damage' && event.amount > 0 && event.phase !== 'over-time')
        this.pending.push(event);
    });
  }
  prepare() {
    if (this.disposed) throw new Error('combat feedback disposed');
    // Compile through the actual covered beauty pass: compileAsync alone uses
    // different light counts/output color space from the postprocessing target.
    // Keep references alive afterward so bursts cannot retire their programs.
    for (const asset of combatEffectAssets) {
      if (this.prepared.has(asset)) continue;
      const pack = this.packs.get(asset);
      if (!pack) throw new Error(`Combat feedback asset not acquired: ${asset}`);
      const clip = Object.values(pack.manifest.asset.clips).flatMap((headings) =>
        Object.values(headings),
      )[0]!;
      const sprite = new ActorSprite(`prepared:${asset}`, pack.manifest, pack.textures, clip);
      this.prepared.set(asset, sprite);
      this.group.add(sprite.mesh);
      sprite.show(
        clip.frames[0]!,
        this.camera.position.clone().addScaledVector(outward, this.camera.far * 4),
        this.camera,
      );
      // Frustum culling is disabled on sprites. Submit this clipped drawing with
      // unchanged material flags, then retire it only after its beauty material
      // (not a depth/focus override) has actually rendered.
      const last = sprite.edgeMesh ?? sprite.mesh,
        beauty = last.material;
      last.onAfterRender = (_renderer, _scene, _camera, _geometry, material) => {
        if (material === beauty) sprite.mesh.visible = false;
      };
    }
    this.primePrepared();
  }
  private primePrepared() {
    if (this.disposed) return;
    for (const sprite of this.prepared.values()) {
      sprite.mesh.position.copy(this.camera.position).addScaledVector(outward, this.camera.far * 4);
      sprite.mesh.visible = true;
    }
  }
  private emit(
    asset: string,
    clipName: string,
    effect: Omit<ActiveEffect, 'sprite' | 'duration'> & { duration?: number },
  ) {
    const pack = this.packs.get(asset);
    if (!pack) throw new Error(`Combat feedback asset not acquired: ${asset}`);
    const clip = pack.manifest.asset.clips[clipName]?.d45;
    if (!clip) throw new Error(`Combat feedback clip missing: ${asset}/${clipName}`);
    const sprite = new ActorSprite(
      `feedback:${asset}:${effect.start}`,
      pack.manifest,
      pack.textures,
      clip,
    );
    sprite.mesh.name = `combat-${effect.kind}`;
    sprite.mesh.userData = { asset, clip: clipName };
    this.group.add(sprite.mesh);
    this.active.push({ ...effect, sprite, duration: effect.duration ?? clipDuration(clip) });
  }
  update(sim: SimulationView, alpha = 1, heroSprite?: ActorSprite) {
    if (this.generation !== sim.generation) {
      for (const effect of this.active) effect.sprite.dispose();
      this.active = [];
      this.castTag = '';
      this.pulse = undefined;
      this.generation = sim.generation;
      this.primePrepared();
    }
    for (const event of this.pending) {
      if (event.generation !== sim.generation) continue;
      const target = sim.actors.find((actor) => actor.id === event.target);
      if (!target) continue;
      this.emit(settings.contact.asset, settings.contact.clip, {
        start: event.tick,
        position: new T.Vector3(target.x, target.y + settings.contact.height, target.z),
        scale: settings.contact.scale,
        reverse: false,
        kind: 'contact',
      });
    }
    this.pending = [];
    const hero = sim.hero,
      timing = attackDefinition(hero),
      tag = `${sim.generation}:${hero.action}`,
      profile = hero.sweepTiming ?? defaultSweepTiming,
      effectTiming = sweepEffectTiming(profile),
      lead = effectTiming?.lead ?? settings.sweep.leadTicks;
    if (
      this.sweepEnabled &&
      hero.state === 'attack' &&
      hero.attackKind === 'sweep' &&
      hero.age >= timing.windup - lead &&
      hero.age < timing.activeEnd &&
      this.castTag !== tag
    ) {
      this.castTag = tag;
      const heading = selectDirection(
        hero.yaw + T.MathUtils.degToRad(settings.sweep.headingOffsetDegrees),
      );
      const code = heading.slice(1).padStart(3, '0');
      this.emit(settings.sweep.asset, `sword_finisher_03__d${code}`, {
        start: sim.tick - (hero.age - (timing.windup - lead)),
        position: new T.Vector3(
          hero.x + Math.sin(hero.yaw) * settings.sweep.forward,
          hero.y + settings.sweep.height,
          hero.z + Math.cos(hero.yaw) * settings.sweep.forward,
        ),
        duration: effectTiming
          ? ((effectTiming.lead + effectTiming.hold + effectTiming.tail) * 1000) / 60
          : settings.sweep.durationMs,
        sweepTiming: effectTiming ? profile : undefined,
        scale: settings.sweep.scale[selectAuthoredDirection(hero.yaw)],
        reverse: settings.sweep.reverse,
        kind: 'sweep',
      });
    }
    const age = hero.age - 1 + alpha;
    const actionStart = sim.tick - hero.age;
    const foot = new T.Vector3(
      hero.px + (hero.x - hero.px) * alpha,
      hero.y,
      hero.pz + (hero.z - hero.pz) * alpha,
    );
    const heading = selectDirection(hero.yaw + Math.PI / 4)
      .slice(1)
      .padStart(3, '0');
    const forward = new T.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
    const rotation = Math.atan2(forward.dot(up), forward.dot(right));
    if (hero.state === 'ability' && age >= tuning.ability.windup - 6 && this.castTag !== tag) {
      this.castTag = tag;
      this.pulse = {
        tick: actionStart + tuning.ability.windup,
        generation: sim.generation,
        action: hero.action,
      };
      const position = foot.clone().add(new T.Vector3(0, 0.7, 0));
      if (heroSprite) heroLanternPosition(heroSprite, position);
      this.flareLight.position.copy(position);
      this.emit(settings.flare.asset, settings.flare.clip, {
        kind: 'flare',
        start: this.pulse.tick - 6,
        position,
        rotation,
        duration: 350,
        scale: settings.flare.scale,
        reverse: false,
      });
    }
    if (
      hero.state === 'attack' &&
      hero.attackKind === 'lunge' &&
      age >= timing.windup - 5 &&
      age < timing.activeEnd &&
      this.castTag !== tag
    ) {
      this.castTag = tag;
      this.emit(settings.lunge.asset, settings.lunge.clip, {
        kind: 'lunge',
        action: hero.action,
        start: actionStart + timing.windup - 5,
        position: foot
          .clone()
          .addScaledVector(forward, 0.6)
          .add(new T.Vector3(0, 0.65, 0)),
        duration: ((timing.activeEnd - timing.windup + 13) * 1000) / 60,
        scale: settings.lunge.scale,
        reverse: false,
        rotation,
      });
    }
    if (hero.state === 'dodge' && age >= tuning.dodge.travelStart && this.castTag !== tag) {
      this.castTag = tag;
      const base = {
        kind: 'dodge' as const,
        start: actionStart + tuning.dodge.travelStart,
        position: foot,
        duration: ((tuning.dodge.travelEnd - tuning.dodge.travelStart + 10) * 1000) / 60,
        reverse: false,
      };
      if (this.dodgeTreatment !== 'leaves')
        this.emit(settings.dodge.asset, `dash_wake__d${heading}`, {
          ...base,
          scale: settings.dodge.scale,
        });
      if (this.dodgeTreatment !== 'dust')
        this.emit(settings.dodgeLeaves.asset, settings.dodgeLeaves.clip, {
          ...base,
          scale: settings.dodgeLeaves.scale,
        });
    }
    if (this.pulse && sim.tick - 1 + alpha < this.pulse.tick) {
      if (hero.action !== this.pulse.action || hero.health <= 0) {
        this.pulse = undefined;
        for (const effect of this.active.filter((e) => e.kind === 'flare')) effect.sprite.dispose();
        this.active = this.active.filter((e) => e.kind !== 'flare');
      } else if (heroSprite && heroLanternPosition(heroSprite, this.flareLight.position)) {
        for (const effect of this.active)
          if (effect.kind === 'flare') effect.position.copy(this.flareLight.position);
      }
    }
    this.flareLight.power =
      this.pulse?.generation === sim.generation
        ? 3.8 * flareLightEnvelope(((sim.tick - 1 + alpha - this.pulse.tick) * 1000) / 60)
        : 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i]!,
        elapsed = Math.max(0, ((sim.tick - 1 + alpha - effect.start) * 1000) / 60);
      if (elapsed >= effect.duration || (effect.kind === 'sweep' && !this.sweepEnabled)) {
        effect.sprite.dispose();
        this.active.splice(i, 1);
      } else {
        const phase =
          effect.kind === 'flare'
            ? elapsed < 100
              ? (elapsed / 100) * 0.57
              : 0.57 + ((elapsed - 100) / 250) * 0.43
            : effect.sweepTiming
              ? sweepEffectPhase(effect.sweepTiming, elapsed)
              : elapsed / effect.duration;
        effect.sprite.animator.seek(
          (effect.reverse ? 1 - phase : phase) * clipDuration(effect.sprite.animator.clip),
        );
        effect.sprite.mesh.scale.setScalar(effect.scale);
        if (effect.kind === 'lunge' && heroSprite && hero.action === effect.action) {
          const tip = new T.Vector3();
          if (heroSwordPosition(heroSprite, effect.position, tip)) {
            const blade = tip.sub(effect.position);
            effect.rotation = Math.atan2(blade.dot(up), blade.dot(right));
          }
        }
        effect.sprite.showAnimation(effect.position, this.camera);
        if (effect.rotation !== undefined) effect.sprite.mesh.rotateZ(effect.rotation);
        if (effect.kind === 'flare') {
          const frame = effect.sprite.lightingSample!.frame;
          const registration = frame.registration ?? effect.sprite.manifest.asset;
          const x =
            (settings.flare.sourceOrigin[0] - registration.anchor[0]) / registration.density;
          const y =
            (registration.anchor[1] - settings.flare.sourceOrigin[1]) / registration.density;
          const offset = new T.Vector3(
            x,
            y,
            y * Math.tan((cameraContract.elevationDeg * Math.PI) / 180),
          )
            .multiplyScalar(effect.scale)
            .applyQuaternion(effect.sprite.mesh.quaternion);
          effect.sprite.mesh.position.sub(offset);
        }
        effect.sprite.material.opacity =
          effect.kind === 'dodge' ? 0.55 * Math.min(1, (effect.duration - elapsed) / 100) : 1;
      }
    }
  }
  reset() {
    for (const effect of this.active) effect.sprite.dispose();
    this.active = [];
    this.pending = [];
    this.castTag = '';
    this.pulse = undefined;
    this.flareLight.power = 0;
    this.primePrepared();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.reset();
    for (const sprite of this.prepared.values()) sprite.dispose();
    this.prepared.clear();
    this.group.removeFromParent();
  }
}
