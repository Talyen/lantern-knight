import * as T from 'three';
import { selectDirection, selectAuthoredDirection, HEADINGS } from '../core/camera';
import { ActorSprite } from './sprite';
import { timedWalk, remapWalkTime } from '../core/locomotion-timing';
import { Animator, clipDuration } from '../core/animation';
import { resolveClip, type Clip } from '../assets/schema';
import { attackDefinition, tuning } from '../content/gameplay';
import { heightAt, surfaceGradient, type ActorId } from '../content/world';
import { actorVisuals } from '../content/visuals';
import type { AnimationEvent } from '../core/events';
import type { Actor, Simulation } from '../core/simulation';
import type { GamePresentation } from './game-scene';
export type Visual = {
  sprite: ActorSprite;
  shadow: T.Mesh<T.CircleGeometry, T.MeshBasicMaterial>;
  ring: T.Mesh;
  tag: string;
  heading: (typeof HEADINGS)[number];
};
export class ActorPresentation {
  readonly actors = new Map<ActorId, Visual>();
  private groundNormal = new T.Vector3(0, 1, 0);
  private planeNormal = new T.Vector3(0, 0, 1);
  constructor(private presentation: GamePresentation) {}
  createVisual(a: Actor, generation: number) {
    const binding = actorVisuals[a.definition.visual];
    if (!binding) throw new Error(`unknown visual ${a.definition.visual}`);
    const pack = this.presentation.packs.get(binding.asset);
    if (!pack) throw new Error(`asset not acquired ${binding.asset}`);
    const sprite = new ActorSprite(
      `${generation}:${a.id}`,
      pack.manifest,
      pack.textures,
      this.getClip(binding.clips.idle, 'd45', pack.manifest),
    );
    sprite.material.color.set(binding.tint);
    const shadow = new T.Mesh(
      new T.CircleGeometry(sprite.manifest.asset.shadow.radius, 32),
      new T.MeshBasicMaterial({
        map: this.presentation.shadowTexture,
        color: 0xffffff,
        transparent: true,
        opacity: sprite.manifest.asset.shadow.opacity,
        depthTest: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    const ring = new T.Mesh(
      new T.RingGeometry(a.definition.radius, a.definition.radius + 0.025, 24),
      new T.MeshBasicMaterial({
        color: a.kind === 'hero' ? 0xd1ba7c : 0xc1645f,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.presentation.room.add(sprite.mesh, shadow, ring);
    const v = { sprite, shadow, ring, tag: '', heading: 'd45' as const };
    this.actors.set(a.id, v);
    return v;
  }
  getClip(id: string, dir: (typeof HEADINGS)[number], manifest = this.presentation.manifest): Clip {
    const clip = resolveClip(manifest, id, dir);
    return id === 'walk' && manifest.asset.id === 'ink-hero-current'
      ? timedWalk(
          clip,
          this.presentation.walkTiming,
          this.presentation.registration.animation.clips[
            `walk:${Object.keys(manifest.asset.clips.walk!).find((h) => manifest.asset.clips.walk![h as (typeof HEADINGS)[number]] === clip)}`
          ]?.weightedHoldsMs,
        )
      : clip;
  }
  update(sim: Simulation, alpha: number, ms: number) {
    for (const a of sim.actors) {
      const v = this.actors.get(a.id) ?? this.createVisual(a, sim.generation),
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
      const selectedClip = this.getClip(id, heading, v.sprite.manifest);
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
            clip.notifies.find((n) => n.kind === 'whoosh')?.atMs ?? (duration * t.windup) / t.total,
          end = strike + (duration * (t.activeEnd - t.windup)) / t.total;
        const visual =
          a.age <= t.windup
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
      } else notifies = v.sprite.animator.advance(ms);
      this.presentation.events.publish(
        notifies.map(
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
      v.sprite.stabilized = a.kind === 'hero' ? this.presentation.stabilized : true;
      v.sprite.rigidSword = this.presentation.rigidSword;
      v.sprite.showAnimation(
        foot,
        this.presentation.camera,
        v.sprite.manifest.asset.id === 'ink-hero-current'
          ? this.presentation.animationTreatment
          : 'original',
        this.presentation.animationFlow,
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
      v.ring.visible =
        this.presentation.debug ||
        (!this.presentation.inkRoom && a.kind === 'enemy' && (a.state === 'attack' || a.stun > 0));
      if (a.kind === 'enemy' && a.state === 'attack') {
        v.ring.scale.setScalar(1 + (a.age / Math.max(1, a.definition.melee.windup)) * 2);
        (v.ring.material as T.MeshBasicMaterial).color.set(
          a.age < a.definition.melee.windup ? 0xc66e55 : 0xe5c37d,
        );
      } else v.ring.scale.setScalar(1);
    }
  }
  dispose() {
    for (const v of this.actors.values()) {
      v.sprite.dispose();
      v.shadow.geometry.dispose();
      v.shadow.material.dispose();
      v.ring.geometry.dispose();
      (v.ring.material as T.Material).dispose();
    }
    this.actors.clear();
  }
}
