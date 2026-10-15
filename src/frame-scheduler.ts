// A background window needs occasional redraws, not a continuous GPU workload.
export class FrameScheduler {
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private background = false;
  private focused = document.hasFocus();
  constructor(
    private draw: (now: number) => void,
    private reset: () => void,
    private automated = false,
    private readonly failed: (error: unknown) => void = (error) => {
      throw error;
    },
  ) {
    window.addEventListener('focus', this.onFocus);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.refresh);
    this.background = this.isBackground();
    try {
      this.reset();
      this.schedule();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  get idle() {
    return this.background;
  }
  private isBackground() {
    return !this.automated && (document.hidden || !this.focused);
  }
  // Electron forwards blur explicitly; hasFocus() can lag that notification.
  private onFocus = () => {
    this.focused = true;
    this.refresh();
  };
  private onBlur = () => {
    this.focused = false;
    this.refresh();
  };
  private cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  private refresh = () => {
    if (this.disposed) return;
    const background = this.isBackground();
    if (background === this.background) return;
    this.background = background;
    this.cancel();
    this.run(() => {
      this.reset();
      this.schedule();
    });
  };
  private schedule() {
    if (this.disposed || this.frame || this.timer !== undefined) return;
    if (this.background) this.timer = setTimeout(() => this.tick(performance.now()), 1000);
    else this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    if (this.disposed) return;
    this.frame = 0;
    this.timer = undefined;
    this.run(() => {
      this.draw(now);
      this.schedule();
    });
  };
  private run(work: () => void) {
    try {
      work();
    } catch (error) {
      // Close cadence and listeners before failure feedback can reenter.
      this.dispose();
      this.failed(error);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    window.removeEventListener('focus', this.onFocus);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.refresh);
  }
}
