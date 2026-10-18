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
        play(event.item === 'gold' ? 'coin' : 'pickup');
        break;
      case 'health-pickup':
        play('heal');
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
    const surface = profile.surface;
    const hero = sim.hero;
    const heroX = hero.x,
      heroZ = hero.z;
    let nearFire = false;
    const campfires = sim.areaDefinition.campfires;
    if (campfires) {
      for (const fire of campfires) {
        const dx = fire.x - heroX,
          dz = fire.z - heroZ;
        if (dx * dx + dz * dz < 16) {
          nearFire = true;
          break;
        }
      }
    }
    // A stable per-frame key avoids rebuilding the joined cue list every frame;
    // the played ambience derives from the area profile and nearby fire only.
    const key = nearFire ? sim.area + ':fire' : sim.area;
    if (key !== this.ambienceKey || this.ambienceGeneration !== sim.generation) {
      this.ambienceKey = key;
      this.ambienceGeneration = sim.generation;
      const destination: readonly AudioCue[] = nearFire
        ? [...profile.ambience.slice(0, 1), 'campfire']
        : profile.ambience;
      void this.playback.setAmbience(destination).catch(() => {});
    }
    for (const actor of sim.actors) {
      let entry = this.movement.get(actor.id);
      if (!entry) {
        this.movement.set(actor.id, { x: actor.x, z: actor.z, distance: 0 });
        continue;
      }
      const dx = actor.x - entry.x,
        dz = actor.z - entry.z,
        movedSquared = dx * dx + dz * dz;
      entry.x = actor.x;
      entry.z = actor.z;
      entry.distance = 0;
      if (contacts.has(actor.id)) continue;
      if (contacts !== this.authored && this.authored.has(actor.id)) continue;
      if (
        frozen ||
        actor.state !== 'walk' ||
        actorVisuals[actor.definition.visual]?.asset === 'ink-hero-current'
      )
        continue;
      if (movedSquared > 1) continue; // teleport/reset, rather than a stride
      const travelled = entry.distance;
      const moved = Math.sqrt(movedSquared);
      entry.distance = travelled + moved;
      if (entry.distance < 0.65) continue;
      entry.distance %= 0.65;
      void this.playback
        .play(`step-${surface}`, {
          key: actor.id,
          critical: actor.kind === 'hero',
          x: actor.x,
          z: actor.z,
        })
        .catch(() => {});
      if (actor.kind === 'hero')
        void this.playback.play('cloth', { key: actor.id }).catch(() => {});
    }
    if (this.movement.size > sim.actors.length) {
      const alive = new Set<string>();
      for (const actor of sim.actors) alive.add(actor.id);
      for (const id of this.movement.keys()) if (!alive.has(id)) this.movement.delete(id);
    }
  }
}
