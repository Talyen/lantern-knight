import * as T from 'three';
import { ActorSprite } from '../presentation/sprite';
import type { Presentation } from '../presentation/scene';
import type { Simulation } from '../core/simulation';
import { clipDuration } from '../core/animation';
import { attackDefinition } from '../content/gameplay';
import type { GameplayEvent } from '../core/events';
import { HEADINGS } from '../core/camera';

type Treatment = {
  label: string;
  asset?: string;
  facingAssets?: boolean;
  impactOnly?: boolean;
  reverse?: boolean;
  scale: number;
  durationMs?: number;
};
export const sweepTreatments = {
  baseline: { label: 'Baseline · no added effects', scale: 1 },
  quiet: {
    label: '01 · Sword Arc 01',
    asset: 'library-sword_arc_01',
    scale: 0.95,
    reverse: true,
    durationMs: 300,
  },
  strong: {
    label: '02 · Sword Arc 02',
    asset: 'library-sword_arc_02',
    scale: 0.95,
    durationMs: 300,
  },
  dramatic: {
    label: '03 · Sword Finisher 03',
    asset: 'library-sword_finisher_03',
    scale: 0.95,
    reverse: true,
    durationMs: 300,
  },
  ribbons: {
    label: '04 · Curling Ember Ribbons',
    asset: 'library-curling_ember_ribbons',
    facingAssets: true,
    scale: 0.8,
    durationMs: 500,
  },
  flame: {
    label: '05 · Layered Flame Tongues',
    asset: 'library-layered_flame_tongues',
    facingAssets: true,
    scale: 0.8,
    durationMs: 500,
  },
  panes: {
    label: '06 · Fractured Amber Panes',
    asset: 'library-fractured_amber_panes',
    facingAssets: true,
    scale: 0.8,
    durationMs: 500,
  },
  chain: { label: '07 · Cursed Chain Strike', asset: 'library-cursed_chain_strike', scale: 0.65 },
  shadow: {
    label: '08 · Ink Shadow Burst · hit',
    asset: 'library-ink_shadow_burst',
    impactOnly: true,
    scale: 0.55,
  },
  amber: {
    label: '09 · Amber Impact · hit',
    asset: 'library-amber_impact',
    impactOnly: true,
    scale: 0.65,
  },
  spectral: {
    label: '10 · Spectral Bolt Impact · hit',
    asset: 'library-spectral_bolt_impact',
    impactOnly: true,
    scale: 0.5,
  },
  shear: {
    label: '11 · Blocked Contact Shear · hit',
    asset: 'library-blocked_contact_shear',
    impactOnly: true,
    scale: 0.9,
  },
  shards: {
    label: '12 · Stagger Shards · hit',
    asset: 'library-stagger_shards',
    impactOnly: true,
    scale: 0.65,
  },
} as const satisfies Record<string, Treatment>;
export type SweepTreatment = keyof typeof sweepTreatments;
const headingCode = (heading: string) => `d${heading.slice(1).padStart(3, '0')}`;
export function sweepAssetsFor(treatment: SweepTreatment) {
  const recipe: Treatment = sweepTreatments[treatment];
  if (!recipe.asset) return [];
  const assets = recipe.facingAssets
    ? HEADINGS.filter((heading) => ['d00', 'd90', 'd180', 'd270'].includes(heading)).map(
        (heading) => `${recipe.asset}__${headingCode(heading)}`,
      )
    : [recipe.asset];
  return [...assets, ...(!recipe.impactOnly ? ['library-neutral_contact_snap'] : [])];
}

type Effect = {
  sprite: ActorSprite;
  start: number;
  duration: number;
  position: T.Vector3;
  reverse: boolean;
  scale: number;
  rotation: number;
};

// Original library sprites only: uniform scale, rigid rotation/placement and playback.
// Preview owns sprite resources; Application owns the acquired pack leases.
export class SweepEffects {
  treatment: SweepTreatment = 'baseline';
  reverse = false;
  rotation = 0;
  readonly group = new T.Group();
  private effects: Effect[] = [];
  private castTag = '';
  private generation = -1;
  private unsubscribe: () => void;
  constructor(
    private view: Presentation,
    private simulation: () => Simulation,
  ) {
    view.scene.add(this.group);
    this.unsubscribe = view.events.subscribe((event) => {
      const sim = simulation();
      this.ensureGeneration(sim);
      if (
        event.kind === 'damage' &&
        event.generation === sim.generation &&
        event.actor === sim.hero.id &&
        sim.hero.attackKind === 'sweep'
      )
        this.hit(event);
    });
  }
  private ensureGeneration(sim: Simulation) {
    if (this.generation !== sim.generation) {
      this.reset();
      this.generation = sim.generation;
    }
  }
  private emit(
    asset: string,
    position: T.Vector3,
    scale: number,
    heading: string,
    duration?: number,
    reverse = false,
    rotation = 0,
  ) {
    const pack = this.view.packs.get(asset);
    if (!pack) throw new Error(`Sweep review effect not loaded: ${asset}`);
    const clipName =
      Object.keys(pack.manifest.asset.clips).find((clip) =>
        clip.endsWith(`__${headingCode(heading)}`),
      ) ?? Object.keys(pack.manifest.asset.clips)[0]!;
    const clip = pack.manifest.asset.clips[clipName]!.d45!;
    const sprite = new ActorSprite(`sweep-review:${asset}`, pack.manifest, pack.textures, clip);
    this.group.add(sprite.mesh);
    this.effects.push({
      sprite,
      start: this.simulation().tick,
      duration: duration ?? clipDuration(clip),
      position,
      scale,
      reverse,
      rotation,
    });
  }
  private hit(event: GameplayEvent & { kind: 'damage' }) {
    const sim = this.simulation(),
      recipe: Treatment = sweepTreatments[this.treatment],
      target = sim.actors.find((actor) => actor.id === event.target);
    if (!recipe.asset || !target) return;
    const asset = recipe.impactOnly ? recipe.asset : 'library-neutral_contact_snap';
    this.emit(
      asset,
      new T.Vector3(target.x, target.y + 0.75, target.z),
      recipe.impactOnly ? recipe.scale : 0.6,
      sim.hero.actionHeading,
      undefined,
      recipe.impactOnly ? this.reverse : false,
      recipe.impactOnly ? this.rotation : 0,
    );
  }
  update(sim: Simulation) {
    this.ensureGeneration(sim);
    const hero = sim.hero,
      recipe: Treatment = sweepTreatments[this.treatment],
      timing = attackDefinition(hero),
      tag = `${sim.generation}:${hero.action}`;
    if (
      recipe.asset &&
      !recipe.impactOnly &&
      hero.state === 'attack' &&
      hero.attackKind === 'sweep' &&
      hero.age >= timing.windup - 3 &&
      hero.age < timing.activeEnd &&
      this.castTag !== tag
    ) {
      this.castTag = tag;
      const asset = recipe.facingAssets
        ? `${recipe.asset}__${headingCode(hero.actionHeading)}`
        : recipe.asset;
      this.emit(
        asset,
        new T.Vector3(
          hero.x + Math.sin(hero.yaw) * 0.35,
          hero.y + 0.3,
          hero.z + Math.cos(hero.yaw) * 0.35,
        ),
        recipe.scale,
        hero.actionHeading,
        recipe.durationMs,
        this.reverse,
        this.rotation,
      );
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]!,
        elapsed = ((sim.tick - effect.start) * 1000) / 60;
      if (elapsed >= effect.duration) {
        effect.sprite.dispose();
        this.effects.splice(i, 1);
      } else {
        const phase = elapsed / effect.duration;
        effect.sprite.animator.seek(
          (effect.reverse ? 1 - phase : phase) * clipDuration(effect.sprite.animator.clip),
        );
        effect.sprite.mesh.scale.setScalar(effect.scale);
        effect.sprite.showAnimation(effect.position, this.view.camera);
        effect.sprite.mesh.rotateZ(T.MathUtils.degToRad(effect.rotation));
      }
    }
  }
  reset() {
    for (const effect of this.effects) effect.sprite.dispose();
    this.effects = [];
    this.castTag = '';
  }
  dispose() {
    this.unsubscribe();
    this.reset();
    this.group.removeFromParent();
  }
}
