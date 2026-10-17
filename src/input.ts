import { cameraContract as contract } from './assets/camera-contract';
import type { Command, HeroAction } from './core/command';
import { walkablePoint, screenMovement } from './presentation/camera';
import { enemyAimPoint } from './presentation/combat-aim';
import type { ActorView } from './core/simulation-view';
import type { Actor } from './core/simulation';
import type { AreaDefinition } from './content/world';
import type { OrthographicCamera } from 'three';
export class Input {
  keys = new Set<string>();
  private potion = false;
  private actions: HeroAction[] = [];
  pointer = { x: 0, y: 0 };
  private lifetime = new AbortController();
  hasPointer = false;
  lastAim: { x: number; z: number } | undefined;
  constructor(
    public canvas: HTMLCanvasElement,
    public camera: OrthographicCamera,
    public pause: () => void,
  ) {
    const signal = this.lifetime.signal;
    const on = <K extends keyof WindowEventMap>(type: K, fn: (event: WindowEventMap[K]) => void) =>
      window.addEventListener(type, fn, { signal });
    const editing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest?.('input,select,textarea') || element?.isContentEditable);
    };
    const control = (target: EventTarget | null) =>
      Boolean((target as Element | null)?.closest?.('button,a[href],summary,[role=button]'));
    on('focusin', (e) => {
      if (editing(e.target) || control(e.target)) this.clear();
    });
    on('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        this.clear();
        return;
      }
      if (editing(e.target) || (e.code !== 'Escape' && control(e.target))) return;
      this.keys.add(e.code);
      if (!e.repeat && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
        this.actions.push('dodge');
      }
      if (e.code === 'KeyQ' && !e.repeat) this.potion = true;
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        this.pause();
      }
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('blur', () => this.clear());
    on('pagehide', () => this.clear());
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.clear();
      },
      { signal },
    );
    on('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      this.hasPointer = true;
    });
    const down = (e: PointerEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.pointer = { x: e.clientX, y: e.clientY };
      this.hasPointer = true;
      if (e.button === 0) {
        this.actions.push('sword');
      }
      if (e.button === 2) {
        this.actions.push('lantern');
      }
    };
    canvas.addEventListener('pointerdown', down, { signal });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
  }
  consume(
    actor: Pick<Actor, 'x' | 'z' | 'aim'> & { y?: number },
    area: AreaDefinition,
    generation: number,
    enemies: readonly ActorView[] = [],
  ): Command {
    const rect = this.canvas.getBoundingClientRect(),
      inside =
        this.hasPointer &&
        this.pointer.x >= rect.left &&
        this.pointer.x <= rect.right &&
        this.pointer.y >= rect.top &&
        this.pointer.y <= rect.bottom;
    const p = inside
      ? (enemyAimPoint(this.camera, this.pointer, rect, actor, enemies, area) ??
        walkablePoint(this.camera, this.pointer.x, this.pointer.y, rect, area))
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
      potion: this.potion,
      actions: this.actions,
    };
    this.potion = false;
    this.actions = [];
    return cmd;
  }
  clear() {
    this.keys.clear();
    this.potion = false;
    this.actions = [];
  }
  resetAim() {
    this.clear();
    this.lastAim = undefined;
    this.hasPointer = false;
  }
  dispose() {
    this.lifetime.abort();
    this.clear();
  }
}
