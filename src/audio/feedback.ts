import type { PresentationEvent } from '../core/events';
import type { SimulationView } from '../core/simulation-view';
import { actorVisuals } from '../content/visuals';
import { areaAudio, type AudioCue } from '../content/audio';
import type { AudioPlayback } from './playback';

export class AudioFeedback {
  private generation = -1;
  private ambienceKey = '';
  private ambienceGeneration = -1;
  private authored = new Set<string>();
  private movement = new Map<string, { x: number; z: number; distance: number }>();
  constructor(private playback: AudioPlayback) {}
  event(event: PresentationEvent, sim: SimulationView, signal: AbortSignal) {
    if (event.generation !== sim.generation) return;
    const actor = sim.actors.find((a) => a.id === event.actor);
    const target =
      event.kind === 'damage' || event.kind === 'stagger'
        ? sim.actors.find((a) => a.id === event.target)
        : actor;
    const play = (cue: AudioCue, world = true) =>
      void this.playback
        .play(cue, {
          world,
          critical: (target ?? actor)?.kind === 'hero',
          x: target?.x ?? event.position[0],
          z: target?.z ?? event.position[2],
          key: target?.id ?? event.actor,
          signal,
        })
        .catch(() => {});
    switch (event.kind) {
      // Strike is the fixed action-contact time for both supplied hero clips and
      // enemies. Do not also play their visual whoosh notify.
      case 'strike':
        // The current ossuary thrall is unarmed; its motion has no metal ring.
        play(actor?.kind === 'enemy' ? 'dodge' : 'sword');
        break;
      case 'flare':
        play('flare');
        break;
      case 'dodge':
        play('dodge');
        break;
      case 'damage':
        if (event.amount > 0 && event.phase !== 'over-time')
          play(target?.kind === 'hero' ? 'hurt' : 'impact');
        break;
      case 'stagger':
        play('bone');
        break;
      case 'death':
        play(actor?.kind === 'hero' ? 'death' : 'bone');
        break;
      case 'potion-used':
        play('potion');
        play('heal');
        break;
      case 'pickup':
        play(
          event.pickup === 'gold'
            ? 'coin'
            : sim.areaDefinition.pickups?.some((p) => p.id === event.pickup)
              ? 'heal'
              : 'pickup',
        );
        break;
      case 'object-claimed': {
        const object = sim.areaDefinition.interactables?.find((o) => o.id === event.object);
        play(object?.kind === 'breakable' ? 'break' : 'container');
        break;
      }
      case 'campfire-discovered':
        play('fire', false);
        break;
      case 'rested':
        play('heal', false);
        break;
      case 'inventory-changed':
        play(
          event.operation === 'upgrade'
            ? 'success'
            : event.operation === 'move' || event.operation === 'organize'
              ? 'ui-confirm'
              : event.operation,
          false,
        );
        if (event.operation === 'equip') play('armor', false);
        break;
      case 'action-unavailable':
        play('ui-deny', false);
        break;
      case 'room-clear':
        play('success');
        break;
      case 'area-transition':
        play('travel', false);
        break;
      case 'room-reset':
        if (event.reason === 'manual') play('ui-confirm', false);
        break;
      // Authored contacts require real movement. Only unmarked kits use distance fallback.
      case 'animation-notify':
        if (
          event.notify === 'footstep' &&
          actor?.state === 'walk' &&
          Math.hypot(actor.x - actor.px, actor.z - actor.pz) > 0.001
        ) {
          this.authored.add(actor.id);
          play(`step-${areaAudio(sim.area).surface}`);
          if (actor.kind === 'hero') play('cloth');
          const movement = this.movement.get(actor.id);
          if (movement) movement.distance = 0;
        }
        break;
      case 'transition-start':
      case 'transition-cancelled':
        break;
    }
  }
  frame(sim: SimulationView, frozen: boolean, contacts: ReadonlySet<string> = this.authored) {
    this.playback.setListener(sim.hero.x, sim.hero.z);
    this.playback.setWorldFrozen(frozen);
    if (this.generation !== sim.generation) {
      this.generation = sim.generation;
      this.movement.clear();
      this.authored.clear();
    }
    const profile = areaAudio(sim.area);
    const nearFire = sim.areaDefinition.campfires?.some(
      (fire) => Math.hypot(fire.x - sim.hero.x, fire.z - sim.hero.z) < 4,
    );
    const destination: readonly AudioCue[] = nearFire
      ? [...profile.ambience.slice(0, 1), 'campfire']
      : profile.ambience;
    const key = destination.join('/');
    if (key !== this.ambienceKey || this.ambienceGeneration !== sim.generation) {
      this.ambienceKey = key;
      this.ambienceGeneration = sim.generation;
      void this.playback.setAmbience(destination).catch(() => {});
    }
    for (const actor of sim.actors) {
      const previous = this.movement.get(actor.id),
        next = { x: actor.x, z: actor.z, distance: 0 };
      this.movement.set(actor.id, next);
      if (
        !previous ||
        frozen ||
        actor.state !== 'walk' ||
        contacts.has(actor.id) ||
        this.authored.has(actor.id) ||
        actorVisuals[actor.definition.visual]?.asset === 'ink-hero-current'
      )
        continue;
      const moved = Math.hypot(actor.x - previous.x, actor.z - previous.z);
      if (moved > 1) continue; // teleport/reset, rather than a stride
      next.distance = previous.distance + moved;
      if (next.distance < 0.65) continue;
      next.distance %= 0.65;
      void this.playback
        .play(`step-${areaAudio(sim.area).surface}`, {
          key: actor.id,
          critical: actor.kind === 'hero',
          x: actor.x,
          z: actor.z,
        })
        .catch(() => {});
      if (actor.kind === 'hero')
        void this.playback.play('cloth', { key: actor.id }).catch(() => {});
    }
    for (const id of this.movement.keys())
      if (!sim.actors.some((a) => a.id === id)) this.movement.delete(id);
  }
}
