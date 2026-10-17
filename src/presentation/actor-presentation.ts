import { footstepClip } from '../content/footsteps';
import { cleanupAll, cleanupAfterFailure, DisposalScope } from '../assets/cleanup';
import * as T from 'three';
import { contactShadowMaterial } from './contact-shadows';
import { selectDirection, selectAuthoredDirection, HEADINGS } from '../content/headings';
import { retimeLanternClip } from './lantern-timing';
import { retimeSweepClip } from './sweep-timing';
import {
  defaultSweepTiming,
  defaultSweepRecovery,
  type SweepTiming,
  type SweepRecovery,
} from '../content/sweep-timing';
import { ActorSprite } from './sprite';
import { timedWalk, remapWalkTime } from '../core/locomotion-timing';
import { Animator, clipDuration } from '../core/animation';
import { resolveActorClip, resolveClip, type Clip } from '../assets/schema';
import { attackDefinition, tuning } from '../content/gameplay';
import { heightAt, surfaceGradient, type ActorId } from '../content/world';
import { actorVisuals } from '../content/visuals';
import type { AnimationEvent } from '../core/events';
import type { ActorView, SimulationView } from '../core/simulation-view';
import type { AssetPack } from '../assets/loader';
import type { PreparedRegistration } from '../assets/registration';
import type { WalkTiming } from '../core/locomotion-timing';
import type { AnimationTreatment } from '../core/animation-treatment';
import type { AnimationFlow } from './animation-blend-shader';
export type ActorOptions = {
  walkTiming: WalkTiming;
  stabilized: boolean;
  rigidSword: boolean;
  animationTreatment: AnimationTreatment;
  animationFlow?: AnimationFlow;
  debug: boolean;
};
export type Visual = {
  sprite: ActorSprite;
  shadow: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  ring: T.Mesh;
  tag: string;
  heading: (typeof HEADINGS)[number];
};
export class ActorPresentation {
  private visuals = new Map<ActorId, Visual & { identity: object; dispose(): void }>();
  // Retain derived identities without keeping retired simulation actors alive.
  private identities = new WeakMap<ActorView, object>();
  private identity(actor: ActorView) {
    let identity = this.identities.get(actor);
    if (!identity) this.identities.set(actor, (identity = {}));
    return identity;
  }
  get actors(): ReadonlyMap<ActorId, Visual> {
    return this.visuals;
  }
  private groundNormal = new T.Vector3(0, 1, 0);
  private planeNormal = new T.Vector3(0, 0, 1);
  constructor(
    private room: T.Group,
    private packs: ReadonlyMap<string, AssetPack>,
    private camera: T.OrthographicCamera,
    private shadowTexture: T.CanvasTexture,
    private registration: PreparedRegistration,
  ) {}
  createVisual(a: ActorView, generation: number) {
    const binding = actorVisuals[a.definition.visual];
    if (!binding) throw new Error(`unknown visual ${a.definition.visual}`);
    const pack = this.packs.get(binding.asset);
    if (!pack) throw new Error(`asset not acquired ${binding.asset}`);
    const resources = new DisposalScope();
    try {
      const sprite = resources.own(
        new ActorSprite(
          `${generation}:${a.id}`,
          pack.manifest,
          pack.textures,
          this.getClip(binding.clips.idle, 'd45', pack.manifest),
        ),
      );
      sprite.material.color.set(binding.tint);
      sprite.mesh.scale.setScalar(binding.scale ?? 1);
      const shadow = new T.Mesh(
        resources.own(
          new T.PlaneGeometry(
            sprite.manifest.asset.shadow.radius * 1.5,
            sprite.manifest.asset.shadow.radius * 1.1,
          ),
        ),
        resources.own(
          contactShadowMaterial(
            this.shadowTexture,
            Math.min(1, sprite.manifest.asset.shadow.opacity * 1.5),
          ),
        ),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.setScalar(binding.scale ?? 1);
      shadow.renderOrder = -1.5;
      const ring = new T.Mesh(
        resources.own(new T.RingGeometry(a.definition.radius, a.definition.radius + 0.025, 24)),
        resources.own(
          new T.MeshBasicMaterial({
            color: a.kind === 'hero' ? 0xd1ba7c : 0xc1645f,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          }),
        ),
      );
      ring.rotation.x = -Math.PI / 2;
      for (const mesh of [sprite.mesh, shadow, ring])
        resources.defer(() => mesh.removeFromParent());
      const v = {
        identity: this.identity(a),
        sprite,
        shadow,
        ring,
        tag: '',
        heading: 'd45' as const,
        dispose: () => resources.dispose(),
      };
      // Register ownership before scene graph observers can throw or re-enter.
      const previous = this.visuals.get(a.id);
      this.visuals.set(a.id, v);
      try {
        previous?.dispose();
        for (const mesh of [sprite.mesh, shadow, ring]) {
          if (this.visuals.get(a.id) !== v)
            throw new Error('Actor visual retired during construction');
          this.room.add(mesh);
          if (this.visuals.get(a.id) !== v)
            throw new Error('Actor visual retired during construction');
        }
        return v;
      } catch (error) {
        if (this.visuals.get(a.id) === v) this.visuals.delete(a.id);
        throw error;
      }
    } catch (error) {
      cleanupAfterFailure(error, () => resources.dispose());
    }
  }

  getClip(
    id: string,
    dir: (typeof HEADINGS)[number],
    manifest = this.packs.get('ink-hero-current')!.manifest,
    walkTiming: WalkTiming = 'weighted',
    sweepTiming: SweepTiming = defaultSweepTiming,
    sweepRecovery: SweepRecovery = defaultSweepRecovery,
  ): Clip {
    const clip = resolveActorClip(manifest, id, dir);
    if (id === 'cast_lantern_flare' && manifest.asset.id === 'ink-hero-current')
      return retimeLanternClip(
        clip,
        selectAuthoredDirection((HEADINGS.indexOf(dir) * Math.PI) / 4),
      );
    if (id === 'sweep' && manifest.asset.id === 'ink-hero-current')
      return retimeSweepClip(
        clip,
        sweepTiming,
        sweepRecovery,
        resolveClip(manifest, 'idle', dir).frames[0],
      );
    return id === 'walk' && manifest.asset.id === 'ink-hero-current'
      ? footstepClip(
          timedWalk(
            clip,
            walkTiming,
            this.registration.animation.clips[
              `walk:${Object.keys(manifest.asset.clips.walk!).find((h) => manifest.asset.clips.walk![h as (typeof HEADINGS)[number]] === clip)}`
            ]?.weightedHoldsMs,
          ),
          dir,
        )
      : clip;
  }
  update(sim: SimulationView, alpha: number, ms: number, options: ActorOptions) {
    const events: AnimationEvent[] = [];
    const live = new Set(sim.actors.map((actor) => actor.id));
    const retired = [...this.visuals].filter(([id]) => !live.has(id));
    for (const [id] of retired) this.visuals.delete(id);
    cleanupAll(retired.map((entry) => () => entry[1].dispose()));
    for (const a of sim.actors) {
      const previousVisual = this.visuals.get(a.id);
      const v =
          previousVisual?.identity === this.identity(a)
            ? previousVisual
            : this.createVisual(a, sim.generation),
        heading =
          v.sprite.manifest.asset.viewMode === 'fixed-authored'
            ? ('d45' as const)
            : v.sprite.manifest.asset.viewMode === 'four-directional' ||
                (v.sprite.manifest.asset.viewMode === 'mixed-directional' && a.state !== 'walk')
              ? a.state === 'idle' || a.state === 'walk'
                ? selectAuthoredDirection(a.yaw, v.heading)
                : a.actionHeading
              : selectDirection(a.yaw, v.heading),
        binding = actorVisuals[a.definition.visual]!,
        id =
          a.state === 'attack'
            ? binding.attacks[a.attackKind === 'lunge' ? 1 : 0]!
            : binding.clips[a.state],
        tag = `${sim.generation}:${id}:${heading}:${a.action}`;
      const selectedClip = this.getClip(
        id,
        heading,
        v.sprite.manifest,
        options.walkTiming,
        a.sweepTiming,
        a.sweepRecovery,
      );
      if (tag !== v.tag || v.sprite.animator.clip !== selectedClip) {
        const old = v.sprite.animator.time,
          previous = v.sprite.animator.clip,
          keepPhase = (a.state === 'walk' || a.state === 'idle') && v.tag.split(':')[1] === id;
        v.sprite.animator.start(selectedClip);
        if (keepPhase)
          v.sprite.animator.seek(
            previous === selectedClip ? old : remapWalkTime(previous, selectedClip, old),
          );
        v.tag = tag;
        v.heading = v.sprite.manifest.asset.viewMode === 'fixed-authored' ? 'd45' : heading;
      }
      const clip = v.sprite.animator.clip;
      if (a.health <= 0 && a.age >= tuning.deathHoldTicks && v.sprite.animator.time === 0)
        v.sprite.animator.seek(clipDuration(clip));
      let notifies: ReturnType<Animator['advance']> = [];
      if (a.kind === 'hero' && a.state !== 'walk' && a.state !== 'idle') {
        notifies = v.sprite.animator.advance(
          Math.max(0, ((a.age - 1 + alpha) * 1000) / 60 - v.sprite.animator.time),
        );
      } else if (a.state === 'attack') {
        const t = attackDefinition(a),
          duration = clipDuration(clip),
          strike =
            binding.attackContactDrawing === undefined
              ? (clip.notifies.find((n) => n.kind === 'whoosh')?.atMs ??
                (duration * t.windup) / t.total)
              : clip.durationsMs
                  .slice(0, binding.attackContactDrawing - 1)
                  .reduce((sum, hold) => sum + hold, 0),
          end = strike + (duration * (t.activeEnd - t.windup)) / t.total;
        const visual =
          t.windup > 0 && a.age <= t.windup
            ? (a.age / t.windup) * strike
            : a.age < t.activeEnd
              ? strike + ((a.age - t.windup) / (t.activeEnd - t.windup)) * (end - strike)
              : end + ((a.age - t.activeEnd) / (t.total - t.activeEnd)) * (duration - end);
        notifies = v.sprite.animator.advance(Math.max(0, visual - v.sprite.animator.time));
      } else if (a.state === 'death')
        notifies = v.sprite.animator.advance(
          Math.max(
            0,
            Math.min(1, a.age / (tuning.enemyDeathHoldTicks - 9)) * clipDuration(clip) -
              v.sprite.animator.time,
          ),
        );
      else if (a.state === 'ability') {
        const duration = clipDuration(clip),
          flash =
            clip.notifies.find((n) => n.kind === 'flash')?.atMs ??
            (duration * tuning.ability.windup) / tuning.ability.total,
          visual =
            a.age <= tuning.ability.windup
              ? (a.age / tuning.ability.windup) * flash
              : flash +
                ((a.age - tuning.ability.windup) / (tuning.ability.total - tuning.ability.windup)) *
                  (duration - flash);
        notifies = v.sprite.animator.advance(Math.max(0, visual - v.sprite.animator.time));
      } else if (a.state === 'dodge' || a.state === 'hurt') {
        const total = a.state === 'dodge' ? tuning.dodge.total : tuning.enemyHurt.total;
        notifies = v.sprite.animator.advance(
          Math.max(0, (a.age / total) * clipDuration(clip) - v.sprite.animator.time),
        );
      } else {
        const moving = Math.hypot(a.x - a.px, a.z - a.pz) > 0.00001;
        notifies = v.sprite.animator.advance(
          a.state === 'walk'
            ? moving
              ? ms * (a.kind === 'hero' ? (Math.hypot(a.x - a.px, a.z - a.pz) * 60) / 3 : 1)
              : 0
            : ms,
        );
      }
      events.push(
        ...notifies.map(
          (n) =>
            ({
              key: `visual:${n.key}`,
              kind: 'animation-notify',
              notify: n.kind,
              clip: id,
              instance: n.instance,
              timeMs: n.timeMs,
              tick: sim.tick,
              generation: sim.generation,
              actor: a.id,
              action: a.action,
              area: sim.area,
              position: Object.freeze([a.x, a.y, a.z]),
              direction: a.yaw,
            }) as AnimationEvent,
        ),
      );
      const x = a.px + (a.x - a.px) * alpha,
        z = a.pz + (a.z - a.pz) * alpha,
        foot = new T.Vector3(x, heightAt(sim.areaDefinition, x, z), z);
      v.sprite.stabilized = a.kind === 'hero' ? options.stabilized : true;
      v.sprite.rigidSword = options.rigidSword;
      const winding =
        a.kind === 'enemy' && a.state === 'attack' && a.age < a.definition.melee.windup;
      // A single late lift preserves the supplied palette, including neutral armor.
      const poisedAccent =
        winding && a.definition.poise
          ? Math.max(0, (a.age / a.definition.melee.windup - 0.5) * 2)
          : 0;
      v.sprite.material.color.set(binding.tint).multiplyScalar(1 + poisedAccent * 0.35);
      v.sprite.showAnimation(
        foot,
        this.camera,
        v.sprite.manifest.asset.id === 'ink-hero-current' ? options.animationTreatment : 'original',
        options.animationFlow,
      );
      v.sprite.mesh.visible =
        a.health > 0 || a.kind === 'hero' || a.age < tuning.enemyDeathHoldTicks;
      const gradient = surfaceGradient(sim.areaDefinition, x, z);
      this.groundNormal.set(-gradient.x, 1, -gradient.z).normalize();
      v.shadow.quaternion.setFromUnitVectors(this.planeNormal, this.groundNormal);
      v.ring.quaternion.copy(v.shadow.quaternion);
      v.shadow.position.set(foot.x, foot.y + 0.03, foot.z);
      v.shadow.visible = a.health > 0;
      v.ring.position.set(foot.x, foot.y + 0.035, foot.z);
      v.ring.visible = options.debug || winding || !!a.burn;
      v.ring.scale.setScalar(winding ? 1 + (0.4 * a.age) / a.definition.melee.windup : 1);
      const material = v.ring.material as T.MeshBasicMaterial;
      // An ongoing status must not obscure the next committed attack.
      material.color.set(winding ? 0xe5c37d : a.burn ? 0xe9a45f : 0xc1645f);
      material.opacity = winding
        ? 0.5 + poisedAccent * 0.2
        : a.burn
          ? a.burn.nextTick < 8
            ? 0.55
            : 0.3
          : 0.5;
    }
    return events;
  }
  dispose() {
    const visuals = [...this.visuals.values()];
    this.visuals.clear();
    cleanupAll(visuals.map((v) => () => v.dispose()));
  }
}
