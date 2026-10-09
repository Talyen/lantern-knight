import * as T from 'three';
import { ActorSprite } from './sprite';
import { combatFeedback as settings } from '../content/combat-feedback';
import { sweepEffectTiming, sweepEffectPhase, type SweepTiming } from '../content/sweep-timing';
import { attackDefinition } from '../content/gameplay';
import { selectDirection, selectAuthoredDirection } from '../core/camera';
import { clipDuration } from '../core/animation';
import type { EventHub, GameplayEvent } from '../core/events';
import type { Simulation } from '../core/simulation';
import type { PackLease } from '../assets/loader';

type ActiveEffect = {
  sprite: ActorSprite;
  start: number;
  duration: number;
  position: T.Vector3;
  reverse: boolean;
  scale: number;
  kind: 'sweep' | 'contact';
  sweepTiming?: SweepTiming;
};
export class CombatFeedback {
  readonly group = new T.Group();
  sweepEnabled = true;
  private active: ActiveEffect[] = [];
  private pending: (GameplayEvent & { kind: 'damage' })[] = [];
  private generation = -1;
  private castTag = '';
  private unsubscribe: () => void;
  constructor(
    private packs: Map<string, PackLease>,
    private camera: T.OrthographicCamera,
    events: EventHub,
  ) {
    this.unsubscribe = events.subscribe((event) => {
      if (event.kind === 'damage' && event.amount > 0) this.pending.push(event);
    });
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
  update(sim: Simulation) {
    if (this.generation !== sim.generation) {
      for (const effect of this.active) effect.sprite.dispose();
      this.active = [];
      this.castTag = '';
      this.generation = sim.generation;
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
      profile = hero.sweepTiming ?? 'baseline',
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
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i]!,
        elapsed = ((sim.tick - effect.start) * 1000) / 60;
      if (elapsed >= effect.duration || (effect.kind === 'sweep' && !this.sweepEnabled)) {
        effect.sprite.dispose();
        this.active.splice(i, 1);
      } else {
        const phase = effect.sweepTiming
          ? sweepEffectPhase(effect.sweepTiming, elapsed)
          : elapsed / effect.duration;
        effect.sprite.animator.seek(
          (effect.reverse ? 1 - phase : phase) * clipDuration(effect.sprite.animator.clip),
        );
        effect.sprite.mesh.scale.setScalar(effect.scale);
        effect.sprite.showAnimation(effect.position, this.camera);
      }
    }
  }
  reset() {
    for (const effect of this.active) effect.sprite.dispose();
    this.active = [];
    this.pending = [];
    this.castTag = '';
  }
  dispose() {
    this.unsubscribe();
    this.reset();
    this.group.removeFromParent();
  }
}
