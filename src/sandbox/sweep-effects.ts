import * as T from 'three';
import { ActorSprite } from '../presentation/sprite';
import type { Presentation } from '../presentation/scene';
import type { Simulation } from '../core/simulation';
import { clipDuration } from '../core/animation';
import { attackDefinition } from '../content/gameplay';
import type { GameplayEvent } from '../core/events';
import { SwordTipTrail } from './sword-tip-trail';

export const sweepTreatments = {
  baseline: { label: 'Baseline · hero artwork only' },
  quiet: { label: 'A · restrained arc', asset: 'library-sword_arc_01', opacity: 0.75 },
  strong: { label: 'B · stronger arc', asset: 'library-sword_arc_02', opacity: 1 },
  dramatic: { label: 'C · finisher arc', asset: 'library-sword_finisher_03', opacity: 1 },
} as const;
export type SweepTreatment = keyof typeof sweepTreatments;
export const sweepEffectAssets = [
  'library-sword_arc_01',
  'library-sword_arc_02',
  'library-sword_finisher_03',
  'library-neutral_contact_snap',
  'library-amber_impact',
] as const;

// Preview owns these sprites; Application owns the loaded pack leases.
export class SweepEffects {
  treatment: SweepTreatment = 'baseline';
  alignment: 'authored' | 'attached' | 'forward' = 'forward';
  readonly group = new T.Group();
  private arc?: ActorSprite;
  private arcTag = '';
  private impacts: { sprite: ActorSprite; start: number; position: T.Vector3 }[] = [];
  private generation = -1;
  private unsubscribe: () => void;
  private tipTrail: SwordTipTrail;
  constructor(
    private view: Presentation,
    private simulation: () => Simulation,
  ) {
    view.scene.add(this.group);
    this.tipTrail = new SwordTipTrail(view, this.group);
    this.unsubscribe = view.events.subscribe((event) => {
      const sim = simulation();
      if (this.generation !== sim.generation) {
        this.reset();
        this.generation = sim.generation;
      }
      if (
        event.kind === 'damage' &&
        event.generation === sim.generation &&
        event.actor === sim.hero.id &&
        sim.hero.attackKind === 'sweep' &&
        this.treatment !== 'baseline'
      )
        this.hit(event);
    });
  }
  private sprite(asset: string, clip: string) {
    const pack = this.view.packs.get(asset);
    if (!pack) throw new Error(`Sweep review effect not loaded: ${asset}`);
    const animation = pack.manifest.asset.clips[clip]?.d45;
    if (!animation) throw new Error(`Sweep review clip missing: ${asset}/${clip}`);
    const sprite = new ActorSprite(
      `sweep-review:${asset}`,
      pack.manifest,
      pack.textures,
      animation,
    );
    this.group.add(sprite.mesh);
    return sprite;
  }
  private hit(event: GameplayEvent & { kind: 'damage' }) {
    const target = this.simulation().actors.find((actor) => actor.id === event.target);
    if (!target) return;
    const dramatic = this.treatment === 'dramatic';
    const sprite = this.sprite(
      dramatic ? 'library-amber_impact' : 'library-neutral_contact_snap',
      dramatic ? 'amber_impact__unoriented' : 'neutral_contact_snap',
    );
    sprite.mesh.scale.setScalar(dramatic ? 0.55 : 0.6);
    this.impacts.push({
      sprite,
      start: event.tick,
      position: new T.Vector3(target.x, target.y + 0.75, target.z),
    });
  }
  update(sim: Simulation) {
    if (this.generation !== sim.generation) {
      this.reset();
      this.generation = sim.generation;
    }
    const hero = sim.hero,
      recipe = sweepTreatments[this.treatment],
      timing = attackDefinition(hero),
      elapsed = ((hero.age - timing.windup + 3) * 1000) / 60;
    const followsTip = this.treatment === 'dramatic' && this.alignment !== 'authored';
    if (followsTip) {
      if (this.arc) this.arc.mesh.visible = false;
      this.tipTrail.update(sim, this.alignment === 'forward' ? 0.14 : 0);
    } else this.tipTrail.reset();
    if (
      !followsTip &&
      'asset' in recipe &&
      hero.state === 'attack' &&
      hero.attackKind === 'sweep' &&
      elapsed >= 0 &&
      elapsed < 200
    ) {
      const tag = `${recipe.asset}:${hero.actionHeading}`;
      if (tag !== this.arcTag) {
        this.arc?.mesh.removeFromParent();
        this.arc?.dispose();
        const heading = hero.actionHeading.slice(1).padStart(3, '0');
        this.arc = this.sprite(recipe.asset, `${recipe.asset.slice(8)}__d${heading}`);
        this.arcTag = tag;
      }
      const arc = this.arc!;
      arc.mesh.visible = true;
      // Keep the peak around the committed damage beat; fade during early recovery.
      arc.animator.seek((elapsed / 200) * clipDuration(arc.animator.clip));
      arc.material.opacity = recipe.opacity;
      arc.mesh.scale.setScalar(timing.range / 2);
      arc.showAnimation(new T.Vector3(hero.x, hero.y + 0.55, hero.z), this.view.camera);
    } else if (this.arc) this.arc.mesh.visible = false;
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const impact = this.impacts[i]!,
        elapsed = ((sim.tick - impact.start) * 1000) / 60;
      if (elapsed >= clipDuration(impact.sprite.animator.clip)) {
        impact.sprite.mesh.removeFromParent();
        impact.sprite.dispose();
        this.impacts.splice(i, 1);
      } else {
        impact.sprite.animator.seek(elapsed);
        impact.sprite.showAnimation(impact.position, this.view.camera);
      }
    }
  }
  reset() {
    this.tipTrail.reset();
    this.arc?.mesh.removeFromParent();
    this.arc?.dispose();
    this.arc = undefined;
    this.arcTag = '';
    for (const impact of this.impacts) {
      impact.sprite.mesh.removeFromParent();
      impact.sprite.dispose();
    }
    this.impacts = [];
  }
  dispose() {
    this.unsubscribe();
    this.reset();
    this.tipTrail.dispose();
    this.group.removeFromParent();
  }
}
