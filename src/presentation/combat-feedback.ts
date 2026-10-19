import * as T from 'three';
import { right, up, outward } from './camera';
import { heroLanternPosition, heroSwordPosition } from './hero-lantern';
import { tuning, attackDefinition, flareLightEnvelope } from '../content/gameplay';
import { actorVisuals } from '../content/visuals';
import { ActorSprite } from './sprite';
import {
  combatFeedback as settings,
  combatEffectAssets,
  ribLaneEffect,
  type CombatEffectBinding,
} from '../content/combat-feedback';
import { selectDirection } from '../content/headings';
import { ribLaneArtwork } from '../content/rib-lane';
import { cameraContract } from '../assets/camera-contract';
import { clipDuration, frameAt } from '../core/animation';
import type { EventHub, GameplayEvent } from '../core/events';
import type { ActorView, SimulationView } from '../core/simulation-view';
import type { Visual } from './actor-presentation';
import type { AssetPack } from '../assets/loader';

type EffectKind = 'sweep' | 'contact' | 'flare' | 'lunge' | 'dodge' | 'enemy-swing';
type ActiveEffect = {
  sprite: ActorSprite;
  binding: CombatEffectBinding;
  kind: EffectKind;
  start: number;
  contact: number;
  end: number;
  sourceContact: number;
  sourceEnd: number;
  position: T.Vector3;
  rotation: number;
  committed: boolean;
  follow?: { actor: ActorView; action: number };
};
type ActionPlan = { kind: EffectKind; windup: number; layers: readonly CombatEffectBinding[] };
export class CombatFeedback {
  readonly group = new T.Group();
  sweepEnabled = true;
  dodgeTreatment: 'dust' | 'leaves' | 'combined' = 'dust';
  readonly flareLight = {
    position: new T.Vector3(),
    power: 0,
    range: tuning.ability.range * 2 + 2,
  };
  readonly cameraKick = new T.Vector3();
  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  private pulse: { tick: number; action: number; committed: boolean } | undefined;
  private active: ActiveEffect[] = [];
  private casts = new Map<string, number>();
  private prepared = new Map<string, ActorSprite>();
  private lanes = new Map<string, ActorSprite>();
  private disposed = false;
  private pending: GameplayEvent[] = [];
  private shocks: { tick: number; x: number; z: number; strength: number }[] = [];
  private impacts: {
    target: ActorView;
    tick: number;
    direction: T.Vector3;
    burn: boolean;
    heavy: boolean;
    frame?: string;
  }[] = [];
  private generation = -1;
  private unsubscribe: () => void;
  constructor(
    private packs: ReadonlyMap<string, AssetPack>,
    private camera: T.OrthographicCamera,
    events: EventHub,
  ) {
    this.unsubscribe = events.subscribe((event) => {
      if (
        (event.kind === 'damage' && event.amount > 0 && event.phase === 'direct') ||
        event.kind === 'strike' ||
        event.kind === 'flare'
      )
        this.pending.push(event);
    });
  }
  prepare() {
    if (this.disposed) throw new Error('combat feedback disposed');
    // Compile through the actual covered beauty pass: compileAsync alone uses
    // different light counts/output color space from the postprocessing target.
    // Keep references alive afterward so bursts cannot retire their programs.
    for (const asset of [
      ...combatEffectAssets,
      ...(this.packs.has(ribLaneEffect.asset) ? [ribLaneEffect.asset] : []),
    ]) {
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
  private plan(actor: ActorView, action = actor.state): ActionPlan | undefined {
    if (action === 'attack') {
      if (actor.definition.attack.kind === 'rib-lane') return;
      const windup = attackDefinition(actor).windup;
      if (actor.kind === 'enemy') {
        const material = actorVisuals[actor.definition.visual]?.combatMaterial;
        if (!material) return;
        return {
          kind: 'enemy-swing',
          windup,
          layers:
            material === 'armor' ? [settings.enemySlam, settings.enemyDust] : [settings.enemySwipe],
        };
      }
      if (actor.attackKind === 'sweep')
        return this.sweepEnabled
          ? { kind: 'sweep', windup, layers: [settings.sweep, settings.sweepEdge] }
          : undefined;
      return { kind: 'lunge', windup, layers: [settings.lunge, settings.lungeBurst] };
    }
    if (actor.kind !== 'hero') return;
    if (action === 'ability')
      return {
        kind: 'flare',
        windup: tuning.ability.windup,
        layers: [settings.flare, settings.flareRays],
      };
    if (action === 'dodge')
      return {
        kind: 'dodge',
        windup: tuning.dodge.travelStart,
        layers:
          this.dodgeTreatment === 'leaves'
            ? [settings.dodgeLeaves]
            : this.dodgeTreatment === 'dust'
              ? [settings.dodge]
              : [settings.dodge, settings.dodgeLeaves],
      };
    return;
  }
  private heavyEnemy(actor: ActorView) {
    return (
      actor.kind === 'enemy' && (!!actor.definition.poise || actor.definition.attack.damage >= 18)
    );
  }
  private placement(
    binding: CombatEffectBinding,
    actor: ActorView,
    alpha: number,
    sprite?: ActorSprite,
  ) {
    const forward = new T.Vector3(Math.sin(actor.yaw), 0, Math.cos(actor.yaw));
    const position = new T.Vector3(
      actor.px + (actor.x - actor.px) * alpha,
      actor.y + binding.height,
      actor.pz + (actor.z - actor.pz) * alpha,
    ).addScaledVector(forward, binding.forward);
    let rotation = binding.orient
      ? Math.atan2(forward.dot(up), forward.dot(right)) -
        T.MathUtils.degToRad(binding.axisDegrees ?? 0)
      : 0;
    if (sprite && binding.attachment === 'lantern') heroLanternPosition(sprite, position);
    if (sprite && binding.attachment === 'sword') {
      const tip = new T.Vector3();
      if (heroSwordPosition(sprite, position, tip) && binding.orient) {
        const blade = tip.sub(position);
        rotation =
          Math.atan2(blade.dot(up), blade.dot(right)) -
          T.MathUtils.degToRad(binding.axisDegrees ?? 0);
      }
    }
    return { position, rotation };
  }
  private emit(
    binding: CombatEffectBinding,
    kind: EffectKind,
    actor: ActorView,
    contact: number,
    lead: number,
    alpha: number,
    sprite?: ActorSprite,
    follow = true,
  ) {
    const pack = this.packs.get(binding.asset);
    if (!pack) throw new Error(`Combat feedback asset not acquired: ${binding.asset}`);
    const code = selectDirection(actor.yaw).slice(1).padStart(3, '0');
    const clipName = binding.directional ? `${binding.clip}__d${code}` : binding.clip;
    const clip = pack.manifest.asset.clips[clipName]?.d45;
    if (!clip) throw new Error(`Combat feedback clip missing: ${binding.asset}/${clipName}`);
    const effect = new ActorSprite(
      `feedback:${binding.asset}:${contact}:${actor.id}`,
      pack.manifest,
      pack.textures,
      clip,
    );
    effect.material.color.setHex(binding.tint ?? 0xffffff);
    effect.mesh.name = `combat-${kind}`;
    effect.mesh.userData = { asset: binding.asset, clip: clipName };
    const pose = this.placement(binding, actor, alpha, sprite);
    if (kind === 'contact') pose.position.addScaledVector(outward, 0.38);
    this.active.push({
      sprite: effect,
      binding,
      kind,
      start: contact - lead,
      contact,
      end: contact + binding.tailTicks,
      sourceContact: binding.contactMs ?? clip.markers?.find((m) => m.id === 'contact')?.atMs ?? 0,
      sourceEnd: clipDuration(clip),
      ...pose,
      committed: !follow || kind === 'dodge',
      follow: follow ? { actor, action: actor.action } : undefined,
    });
    this.group.add(effect.mesh);
  }
  private begin(
    actor: ActorView,
    plan: ActionPlan,
    contact: number,
    alpha: number,
    sprites: ReadonlyMap<string, Visual> | undefined,
    action = actor.action,
    lead = plan.windup,
  ) {
    const tag = `${actor.id}:${action}`;
    if (this.casts.has(tag)) return;
    let tail = 0;
    for (const layer of plan.layers) if (layer.tailTicks > tail) tail = layer.tailTicks;
    this.casts.set(tag, contact + tail);
    for (const binding of plan.layers)
      this.emit(
        binding,
        plan.kind,
        actor,
        contact,
        Math.min(lead, binding.leadTicks),
        alpha,
        sprites?.get(actor.id)?.sprite,
        lead > 0,
      );
    if (plan.kind === 'flare') this.pulse = { tick: contact, action, committed: lead === 0 };
  }
  private clearLanes() {
    for (const sprite of this.lanes.values()) sprite.dispose();
    this.lanes.clear();
  }
  private updateLanes(sim: SimulationView, alpha: number) {
    const ids = new Set(sim.ribLanes.map((lane) => lane.id));
    for (const [id, sprite] of this.lanes) {
      if (ids.has(id)) continue;
      sprite.dispose();
      this.lanes.delete(id);
    }
    for (const lane of sim.ribLanes) {
      const pack = this.packs.get(ribLaneEffect.asset);
      const clip = pack?.manifest.asset.clips[ribLaneEffect.clip]?.d45;
      if (!pack || !clip) throw new Error('Rib lane artwork not acquired');
      let sprite = this.lanes.get(lane.id);
      if (!sprite) {
        sprite = new ActorSprite(`rib-lane:${lane.id}`, pack.manifest, pack.textures, clip);
        sprite.mesh.name = 'combat-rib-lane';
        this.lanes.set(lane.id, sprite);
        this.group.add(sprite.mesh);
      }
      const age = Math.max(0, lane.age - 1 + alpha);
      const contact = clip.markers?.find((m) => m.id === 'contact')?.atMs ?? 1020;
      const elapsed =
        age < lane.windup
          ? (age * contact) / lane.windup
          : contact + ((age - lane.windup) * (1530 - contact)) / (lane.total - lane.windup);
      const scale = lane.length / ribLaneArtwork.worldLength;
      sprite.mesh.scale.setScalar(scale);
      const position = new T.Vector3(lane.x, lane.y + 0.025, lane.z)
        .addScaledVector(right, -ribLaneArtwork.centerOffset.x * scale)
        .addScaledVector(up, -ribLaneArtwork.centerOffset.y * scale)
        .addScaledVector(
          outward,
          (ribLaneArtwork.centerOffset.y * scale) /
            Math.tan(T.MathUtils.degToRad(cameraContract.elevationDeg)),
        );
      sprite.show(frameAt(clip, elapsed), position, this.camera);
      // Preserve every projected source pixel while giving the card ground depth.
      const vertices = sprite.geometry.getAttribute('position') as T.BufferAttribute;
      for (let i = 0; i < vertices.count; i++)
        vertices.setZ(
          i,
          -vertices.getY(i) / Math.tan(T.MathUtils.degToRad(cameraContract.elevationDeg)),
        );
      vertices.needsUpdate = true;
      sprite.mesh.userData = { age, x: lane.x, z: lane.z, length: lane.length, width: lane.width };
    }
  }
  update(
    sim: SimulationView,
    alpha = 1,
    heroSprite?: ActorSprite,
    actors?: ReadonlyMap<string, Visual>,
  ) {
    if (this.disposed) return;
    if (this.generation !== sim.generation) {
      // Preserve only queued outcomes belonging to the newly accepted room.
      const pending = this.pending.filter((event) => event.generation === sim.generation);
      this.reset();
      this.pending = pending;
      this.generation = sim.generation;
    }
    const clock = sim.tick - 1 + alpha;
    for (const [tag, end] of this.casts) if (end < clock) this.casts.delete(tag);
    this.updateLanes(sim, alpha);
    for (const actor of sim.actors) {
      if (actor.health <= 0) continue;
      const plan = this.plan(actor);
      if (!plan) continue;
      // Actions are admitted at age zero, then aged after combat resolves.
      const contact = sim.tick - actor.age + plan.windup + 1;
      let lead = 0,
        tail = 0;
      for (const layer of plan.layers) {
        if (layer.leadTicks > lead) lead = layer.leadTicks;
        if (layer.tailTicks > tail) tail = layer.tailTicks;
      }
      if (clock >= contact - Math.min(plan.windup, lead) && clock < contact + tail)
        this.begin(actor, plan, contact, alpha, actors);
    }
    const actorsById = new Map(sim.actors.map((actor) => [actor.id, actor] as const));
    for (const event of this.pending) {
      if (event.generation !== sim.generation) continue;
      const source = actorsById.get(event.actor);
      if (event.kind === 'strike' || event.kind === 'flare') {
        if (!source) continue;
        const plan = this.plan(source, event.kind === 'flare' ? 'ability' : 'attack');
        if (plan) {
          const recorded: ActorView = {
            ...source,
            x: event.position[0],
            px: event.position[0],
            y: event.position[1],
            z: event.position[2],
            pz: event.position[2],
            yaw: event.direction,
            action: event.action,
          };
          this.begin(recorded, plan, event.tick, alpha, actors, event.action, 0);
        }
        for (const effect of this.active)
          if (effect.follow?.actor.id === event.actor && effect.follow.action === event.action)
            effect.committed = true;
        if (event.kind === 'flare' && this.pulse?.action === event.action)
          this.pulse.committed = true;
        const strength = event.kind === 'flare' ? 0.05 : this.heavyEnemy(source) ? 0.045 : 0;
        if (strength)
          this.shocks.push({
            tick: event.tick,
            x: event.position[0],
            z: event.position[2],
            strength,
          });
        continue;
      }
      if (event.kind !== 'damage') continue;
      const target = actorsById.get(event.target);
      if (!target) continue;
      const direction = new T.Vector3(
        target.x - event.position[0],
        0,
        target.z - event.position[2],
      );
      if (direction.lengthSq() < 0.0001)
        direction.set(Math.sin(event.direction), 0, Math.cos(event.direction));
      direction.normalize();
      const burn = event.damageType === 'burn',
        heavy =
          burn ||
          !!source?.definition.poise ||
          (source?.kind === 'hero' && source.attackKind === 'lunge') ||
          target.health <= 0;
      this.impacts = this.impacts.filter((impact) => impact.target !== target);
      this.impacts.push({ target, tick: event.tick, direction, burn, heavy });
      const binding: CombatEffectBinding = burn ? settings.contactBurn : settings.contact;
      this.emit(binding, 'contact', target, event.tick, 0, alpha, undefined, false);
      const contact = this.active.at(-1)!;
      if (binding.orient)
        contact.rotation =
          Math.atan2(direction.dot(up), direction.dot(right)) -
          T.MathUtils.degToRad(binding.axisDegrees ?? 0);
      const material = actorVisuals[target.definition.visual]?.combatMaterial;
      if (!burn && target.kind === 'enemy' && material)
        this.emit(
          material === 'armor' ? settings.contactArmor : settings.contactBone,
          'contact',
          target,
          event.tick,
          0,
          alpha,
          undefined,
          false,
        );
    }
    this.pending = [];
    if (
      this.pulse &&
      !this.pulse.committed &&
      (sim.hero.action !== this.pulse.action || sim.hero.health <= 0)
    )
      this.pulse = undefined;
    if (this.pulse && clock <= this.pulse.tick) {
      this.flareLight.position.set(sim.hero.x, sim.hero.y + 0.9, sim.hero.z);
      if (heroSprite) heroLanternPosition(heroSprite, this.flareLight.position);
    }
    this.flareLight.power = this.pulse
      ? 5.2 * flareLightEnvelope((((clock - this.pulse.tick) * 1000) / 60) * 0.6)
      : 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i]!;
      const owner = effect.follow;
      const cancelled =
        !effect.committed &&
        owner &&
        (owner.actor.action !== owner.action ||
          owner.actor.health <= 0 ||
          !sim.actors.includes(owner.actor));
      if (clock >= effect.end || cancelled || (effect.kind === 'sweep' && !this.sweepEnabled)) {
        effect.sprite.dispose();
        this.active.splice(i, 1);
        continue;
      }
      if (clock < effect.start) {
        effect.sprite.mesh.visible = false;
        continue;
      }
      effect.sprite.mesh.visible = true;
      const travel = effect.binding.attachment === 'travel';
      if (
        owner &&
        travel &&
        (owner.actor.action !== owner.action ||
          owner.actor.health <= 0 ||
          !sim.actors.includes(owner.actor))
      )
        effect.follow = undefined;
      else if (owner) {
        const pose = this.placement(
          effect.binding,
          owner.actor,
          alpha,
          actors?.get(owner.actor.id)?.sprite,
        );
        effect.position.copy(pose.position);
        effect.rotation = pose.rotation;
        if (clock >= effect.contact && !travel) effect.follow = undefined;
      }
      const time =
        clock < effect.contact
          ? effect.sourceContact *
            T.MathUtils.clamp(
              (clock - effect.start) / Math.max(1, effect.contact - effect.start),
              0,
              1,
            )
          : effect.sourceContact +
            ((effect.sourceEnd - effect.sourceContact) * (clock - effect.contact)) /
              (effect.end - effect.contact);
      effect.sprite.animator.seek(Math.max(0, time));
      effect.sprite.mesh.scale.setScalar(effect.binding.scale);
      effect.sprite.showAnimation(effect.position, this.camera);
      if (effect.rotation) effect.sprite.mesh.rotateZ(effect.rotation);
      effect.sprite.material.opacity = Math.min(1, Math.max(0, (effect.end - clock) / 4));
    }
    const now = sim.tick - 1 + alpha;
    this.cameraKick.set(0, 0, 0);
    this.shocks = this.shocks.filter((shock) => now - shock.tick < 10);
    if (!this.reducedMotion)
      for (const shock of this.shocks) {
        const age = Math.max(0, now - shock.tick),
          distance = Math.hypot(sim.hero.x - shock.x, sim.hero.z - shock.z);
        const strength =
          shock.strength * Math.max(0, 1 - distance / 6) * Math.exp(-age / 3) * Math.cos(age * 0.6);
        if (Math.abs(strength) > this.cameraKick.length())
          this.cameraKick.copy(up).multiplyScalar(-strength);
      }

    if (this.impacts.length)
      this.impacts = this.impacts.filter(
        (impact) => sim.actors.includes(impact.target) && now - impact.tick < 16,
      );
    for (const impact of this.impacts) {
      const visual = actors?.get(impact.target.id);
      if (!visual) continue;
      const age = Math.max(0, now - impact.tick),
        // Quick outward impulse, a small counter-settle, then the supplied pose.
        kick =
          age < 2
            ? 0.65 + (0.35 * age) / 2
            : Math.exp(-(age - 2) / 3.2) * Math.cos((age - 2) * 0.42),
        distance =
          (impact.target.definition.poise && !impact.burn && impact.target.health > 0
            ? 0.045
            : impact.heavy
              ? 0.16
              : 0.11) * kick,
        flash = Math.max(0, 1 - age / 5);
      if (
        age < 2 &&
        (!impact.target.definition.poise || impact.burn || impact.target.health <= 0)
      ) {
        impact.frame ??= visual.sprite.animator.frame;
        visual.sprite.show(impact.frame, visual.sprite.mesh.position.clone(), this.camera);
      }
      visual.sprite.mesh.position.addScaledVector(impact.direction, distance);
      visual.sprite.mesh.rotateZ(-impact.direction.dot(right) * kick * 0.035);
      visual.sprite.material.color
        .lerp(
          new T.Color(impact.burn ? 0xffd29a : impact.target.kind === 'hero' ? 0xffc2ad : 0xfff0ce),
          flash * 0.8,
        )
        .multiplyScalar(1 + flash * 0.45);
      visual.sprite.edgeMaterial?.color.copy(visual.sprite.material.color);
      if (!this.reducedMotion) {
        const strength =
            (impact.target.kind === 'hero' ? 0.085 : impact.heavy ? 0.045 : 0.025) * kick,
          offset = right
            .clone()
            .multiplyScalar(impact.direction.dot(right) * strength)
            .addScaledVector(up, -strength * 0.35);
        if (offset.lengthSq() > this.cameraKick.lengthSq()) this.cameraKick.copy(offset);
      }
    }
  }
  reset() {
    this.clearLanes();
    // Installation has selected the new room; retire old borrowed representatives
    // before SceneAssets releases the previous room's leases.
    for (const [asset, sprite] of this.prepared) {
      if (this.packs.has(asset)) continue;
      this.prepared.delete(asset);
      sprite.dispose();
    }
    for (const effect of this.active) effect.sprite.dispose();
    this.active = [];
    this.pending = [];
    this.impacts = [];
    this.shocks = [];
    this.casts.clear();
    this.pulse = undefined;
    this.flareLight.power = 0;
    this.cameraKick.set(0, 0, 0);
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
