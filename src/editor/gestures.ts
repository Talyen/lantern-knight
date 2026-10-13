import { cleanupAll } from '../assets/cleanup';

export interface GestureLease {
  readonly active: boolean;
  // Detach before committing: releasing capture may synchronously dispatch events.
  finish(): boolean;
  cancel(): void;
}
type Capture = Pick<
  HTMLElement,
  | 'setPointerCapture'
  | 'hasPointerCapture'
  | 'releasePointerCapture'
  | 'addEventListener'
  | 'removeEventListener'
>;
type Gesture = {
  target: Capture;
  pointer: number;
  cancel: () => void;
  lost: (event: Event) => void;
};

// Every tool borrows one gesture lifetime. Document operations revoke it before
// replacing the scene, so a late pointer release cannot edit a different document.
export class EditorGestures {
  private current?: Gesture;
  private closed = false;
  private suspended = 0;
  private lifetime = new AbortController();
  constructor() {
    const signal = this.lifetime.signal;
    window.addEventListener('blur', () => this.cancel(), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.cancel();
      },
      { signal },
    );
  }
  private detach(gesture: Gesture) {
    if (this.current === gesture) this.current = undefined;
    gesture.target.removeEventListener('lostpointercapture', gesture.lost);
    if (gesture.target.hasPointerCapture(gesture.pointer))
      gesture.target.releasePointerCapture(gesture.pointer);
  }
  private revoke(gesture: Gesture) {
    cleanupAll([() => this.detach(gesture), gesture.cancel]);
  }
  begin(target: Capture, pointer: number, cancel: () => void): GestureLease {
    if (this.closed) throw new Error('Editor gestures disposed');
    if (this.suspended) return inactiveGesture;
    this.cancel();
    if (this.closed || this.suspended || this.current) return inactiveGesture;
    const gesture: Gesture = {
      target,
      pointer,
      cancel,
      lost: (event) => {
        if ((event as PointerEvent).pointerId === pointer && this.current === gesture)
          this.cancel();
      },
    };
    this.current = gesture;
    try {
      if (this.current === gesture) {
        target.addEventListener('lostpointercapture', gesture.lost);
        target.setPointerCapture(pointer);
      }
    } catch (error) {
      if (this.current === gesture) this.cancel();
      throw error;
    }
    const active = () => this.current === gesture;
    return {
      get active() {
        return active();
      },
      finish: () => {
        if (this.current !== gesture) return false;
        this.detach(gesture);
        return true;
      },
      cancel: () => {
        if (this.current === gesture) this.cancel();
      },
    };
  }
  cancel() {
    const gesture = this.current;
    if (!gesture) return;
    this.current = undefined;
    this.revoke(gesture);
  }
  suspend() {
    this.suspended++;
    try {
      this.cancel();
    } catch (error) {
      this.suspended--;
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.suspended--;
    };
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    this.cancel();
  }
}

const inactiveGesture: GestureLease = Object.freeze({
  active: false,
  finish: () => false,
  cancel: () => {},
});
