// Electron quit events do not await promises. Keep the process alive until the
// session has closed storage admission and drained work it already accepted.
export class DesktopShutdown {
  private phase: 'active' | 'draining' | 'ready' = 'active';
  constructor(
    private readonly close: () => Promise<void>,
    private readonly quit: () => void,
  ) {}
  get requested() {
    return this.phase !== 'active';
  }
  request(event: { preventDefault(): void }) {
    if (this.phase === 'ready') return;
    event.preventDefault();
    if (this.phase === 'draining') return;
    this.phase = 'draining';
    try {
      void this.close().then(
        () => this.finish(),
        (error: unknown) => this.failed(error),
      );
    } catch (error) {
      this.failed(error);
    }
  }
  private failed(error: unknown) {
    console.error('Unable to finish desktop storage shutdown:', error);
    this.finish();
  }
  private finish() {
    this.phase = 'ready';
    this.quit();
  }
}
