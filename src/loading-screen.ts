import { loadingVideoPath } from './content/loading-media';

export class LoadingScreen {
  private dialog = document.querySelector<HTMLDialogElement>('#loading-screen')!;
  private video = this.dialog.querySelector('video')!;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private active = false;
  private disposed = false;
  private failed = false;
  private focus: HTMLElement | null = null;
  constructor() {
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.src = '/' + loadingVideoPath;
    this.video.addEventListener('error', this.fail);
    this.video.addEventListener('loadeddata', this.play);
    document.addEventListener('visibilitychange', this.play);
    this.motion.addEventListener('change', this.play);
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel'])
      window.addEventListener(type, this.blockInput, { capture: true, passive: false });
    this.dialog.addEventListener('cancel', this.preventCancel);
    this.set(true);
  }
  private preventCancel = (event: Event) => event.preventDefault();
  private blockInput = (event: Event) => {
    if (!this.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  private fail = () => {
    this.failed = true;
    this.video.pause();
    this.dialog.dataset.failed = 'true';
  };
  private play = () => {
    if (!this.active || document.hidden || this.motion.matches || this.failed) {
      this.video.pause();
      return;
    }
    void this.video.play().catch((error: unknown) => {
      // A quick load, reduced-motion change or hidden window can interrupt play().
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (this.active && !this.disposed && !document.hidden && !this.motion.matches) this.fail();
    });
  };
  // Pause dialogs can enter the top layer while a load is pending (for example on blur).
  raise() {
    if (!this.active || this.disposed) return;
    this.dialog.close();
    this.dialog.showModal();
  }
  set = (active: boolean) => {
    if (this.disposed || active === this.active) return;
    this.active = active;
    if (active) {
      this.focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.video.currentTime = 0;
      this.raise();
      this.play();
    } else {
      this.video.pause();
      this.dialog.close();
      const modal = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
      const previous = this.focus;
      const target =
        previous &&
        previous !== document.body &&
        previous.isConnected &&
        previous.getClientRects().length &&
        !previous.closest('[inert]') &&
        (!modal || modal.contains(previous))
          ? previous
          : (modal?.querySelector<HTMLElement>('[autofocus], button') ??
            document.querySelector<HTMLCanvasElement>('canvas'));
      target?.focus();
      this.focus = null;
    }
  };
  dispose() {
    if (this.disposed) return;
    this.set(false);
    this.disposed = true;
    this.video.removeEventListener('error', this.fail);
    this.video.removeEventListener('loadeddata', this.play);
    document.removeEventListener('visibilitychange', this.play);
    this.motion.removeEventListener('change', this.play);
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel'])
      window.removeEventListener(type, this.blockInput, true);
    this.dialog.removeEventListener('cancel', this.preventCancel);
    this.video.removeAttribute('src');
    this.video.load();
  }
}
