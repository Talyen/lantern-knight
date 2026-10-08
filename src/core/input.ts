import type { Command } from './simulation';
import { walkablePoint, screenMovement, contract } from './camera';
import type { Actor } from './simulation';
import type { AreaDefinition } from '../content/world';
import type { OrthographicCamera } from 'three';
export class Input {
  keys = new Set<string>();
  edges = { attack: false, dodge: false, ability: false };
  pointer = { x: 0, y: 0 };
  cleanups: (() => void)[] = [];
  hasPointer = false;
  lastAim: { x: number; z: number } | undefined;
  constructor(
    public canvas: HTMLCanvasElement,
    public camera: OrthographicCamera,
    public pause: () => void,
  ) {
    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (event: WindowEventMap[K]) => void,
    ) => {
      window.addEventListener(type, fn);
      this.cleanups.push(() => window.removeEventListener(type, fn));
    };
    on('keydown', (e) => {
      if ((e.target as HTMLElement).matches('input,select,textarea')) return;
      this.keys.add(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.edges.dodge = !e.repeat;
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        this.pause();
      }
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('blur', () => this.clear());
    on('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      this.hasPointer = true;
    });
    const down = (e: PointerEvent) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      this.hasPointer = true;
      if (e.button === 0) this.edges.attack = true;
      if (e.button === 2) this.edges.ability = true;
    };
    canvas.addEventListener('pointerdown', down);
    this.cleanups.push(() => canvas.removeEventListener('pointerdown', down));
    const context = (e: Event) => e.preventDefault();
    canvas.addEventListener('contextmenu', context);
    this.cleanups.push(() => canvas.removeEventListener('contextmenu', context));
  }
  consume(
    actor: Pick<Actor, 'x' | 'z' | 'aim'>,
    area: AreaDefinition,
    generation: number,
  ): Command {
    const rect = this.canvas.getBoundingClientRect(),
      inside =
        this.hasPointer &&
        this.pointer.x >= rect.left &&
        this.pointer.x <= rect.right &&
        this.pointer.y >= rect.top &&
        this.pointer.y <= rect.bottom;
    const p = inside
      ? walkablePoint(this.camera, this.pointer.x, this.pointer.y, rect, area)
      : null;
    if (p && Math.hypot(p.x - actor.x, p.z - actor.z) > 0.001) this.lastAim = { x: p.x, z: p.z };
    const cmd = {
      move: screenMovement(
        Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
        Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
        contract.movement === 'world' ? 'world' : 'screen-relative',
      ),
      aim: this.lastAim ?? { x: actor.x + Math.sin(actor.aim), z: actor.z + Math.cos(actor.aim) },
      generation,
      ...this.edges,
    };
    this.edges = { attack: false, dodge: false, ability: false };
    return cmd;
  }
  clear() {
    this.keys.clear();
    this.edges = { attack: false, dodge: false, ability: false };
  }
  resetAim() {
    this.clear();
    this.lastAim = undefined;
    this.hasPointer = false;
  }
  dispose() {
    this.cleanups.forEach((f) => f());
    this.clear();
  }
}
