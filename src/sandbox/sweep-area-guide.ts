import * as T from 'three';
import { attackDefinition } from '../content/gameplay';
import { heightAt } from '../content/world';
import type { Simulation } from '../core/simulation';

// Diagnostic geometry only; the production effect remains the untouched library sprite.
export class SweepAreaGuide {
  readonly group = new T.Group();
  enabled = false;
  probes = false;
  private ground = new T.Line(
    new T.BufferGeometry(),
    new T.LineBasicMaterial({ color: 0x66dce6, transparent: true, opacity: 0.85 }),
  );
  private raised = new T.Line(
    new T.BufferGeometry(),
    new T.LineBasicMaterial({ color: 0xe7c780, transparent: true, opacity: 0.8 }),
  );
  private labels: T.Sprite[] = [];
  constructor(scene: T.Scene) {
    this.group.add(this.ground, this.raised);
    scene.add(this.group);
    for (let i = 0; i < 5; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = 'bold 42px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f0dfb8';
      ctx.fillText(String(i + 1), 32, 32);
      const texture = new T.CanvasTexture(canvas);
      const sprite = new T.Sprite(
        new T.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
      );
      sprite.scale.set(0.3, 0.3, 1);
      this.labels.push(sprite);
      this.group.add(sprite);
    }
  }
  update(sim: Simulation) {
    const hero = sim.hero,
      attack = attackDefinition({ ...hero, attackKind: 'sweep' as const });
    for (const [line, height] of [
      [this.ground, 0.035],
      [this.raised, 0.9],
    ] as const) {
      const points: T.Vector3[] = [new T.Vector3(hero.x, hero.y + height, hero.z)];
      for (let i = 0; i <= 48; i++) {
        const angle = hero.yaw - attack.halfAngle + (2 * attack.halfAngle * i) / 48,
          x = hero.x + Math.sin(angle) * attack.range,
          z = hero.z + Math.cos(angle) * attack.range;
        points.push(new T.Vector3(x, heightAt(sim.areaDefinition, x, z) + height, z));
      }
      points.push(new T.Vector3(hero.x, hero.y + height, hero.z));
      line.geometry.setFromPoints(points);
      line.visible = this.enabled;
    }
    for (let i = 0; i < this.labels.length; i++) {
      const target = sim.enemies.find((actor) => actor.id.endsWith(`/sweep-target-${i}`)),
        label = this.labels[i]!;
      label.visible = this.probes && !!target;
      if (target) label.position.set(target.x, target.y + 0.22, target.z);
    }
    this.group.visible = this.enabled || this.probes;
  }
  reset() {
    this.probes = false;
    this.group.visible = false;
  }
  dispose() {
    this.group.removeFromParent();
    for (const line of [this.ground, this.raised]) {
      line.geometry.dispose();
      line.material.dispose();
    }
    for (const label of this.labels) {
      label.material.map?.dispose();
      label.material.dispose();
    }
  }
}
