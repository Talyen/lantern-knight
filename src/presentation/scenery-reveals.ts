import * as T from 'three';
import { heightAt, type AreaDefinition } from '../content/world';
import { contract, outward, right, up } from '../core/camera';
import type { Simulation } from '../core/simulation';
import type { ActorSprite } from './sprite';
import { SceneryReveal, cardCoverage, type CoverageMask } from './scenery-reveal';
import type { PreparedRegistration } from '../assets/registration';
import type { WorldVisualDefinition } from '../content/world-art';

export class SceneryReveals {
  private reveals: SceneryReveal[] = [];
  constructor(
    private area: AreaDefinition,
    private coverage: PreparedRegistration['coverage'],
    private art: WorldVisualDefinition,
  ) {}
  add(sprite: ActorSprite) {
    this.reveals.push(new SceneryReveal(sprite));
  }
  update(sim: Simulation, alpha: number, ms: number) {
    const actors = [sim.hero, ...sim.enemies.filter((a) => a.health > 0)];
    for (const reveal of this.reveals) {
      const s = reveal.sprite,
        wall = this.art.walls.find((w) => w.id === s.mesh.userData.siteWall),
        mask = (this.coverage.masks as Record<string, CoverageMask>)[
          `${s.manifest.asset.id}:${s.animator.frame}`
        ];
      const points = actors.map((a) => {
        const x = a.px + (a.x - a.px) * alpha,
          z = a.pz + (a.z - a.pz) * alpha,
          root = new T.Vector3(x, heightAt(this.area, x, z), z),
          height =
            (a.kind === 'hero' ? 1.8 : 1.7) * Math.cos((contract.elevationDeg * Math.PI) / 180),
          base = s.mesh.position.clone();
        if (wall) {
          const dx = wall.to.x - wall.from.x,
            dz = wall.to.z - wall.from.z,
            t = Math.max(
              0,
              Math.min(1, ((x - wall.from.x) * dx + (z - wall.from.z) * dz) / (dx * dx + dz * dz)),
            );
          base.set(wall.from.x + dx * t, root.y, wall.from.z + dz * t);
        }
        const ahead = root.clone().sub(base).dot(outward) < 0.1,
          hit =
            ahead &&
            [0.08, 0.18, 0.35, 0.65, 0.85].some((v) =>
              [-0.18, 0, 0.18].some(
                (offset) =>
                  cardCoverage(
                    s,
                    root
                      .clone()
                      .addScaledVector(up, height * v)
                      .addScaledVector(right, offset),
                    mask,
                  ) > 0.25,
              ),
            );
        return {
          center: new T.Vector2(root.dot(right), root.dot(up) + height * 0.51),
          size: new T.Vector2(0.62, height * 0.68),
          obscures: hit,
        };
      });
      reveal.update(points, ms);
    }
  }
  revealStats() {
    return this.reveals.map((r) => ({
      id: r.sprite.id,
      strength: r.sprite.mesh.userData.revealStrength ?? 0,
      opacity: r.sprite.material.opacity,
      transparent: r.sprite.material.transparent,
      depthWrite: r.sprite.material.depthWrite,
    }));
  }
  dispose() {
    this.reveals = [];
  }
}
