import type { AudioBufferLease } from './buffers';
import { cleanupAll } from '../assets/cleanup';

// A voice owns its source, gain, decoded lease and cancellation subscription.
// Every completion path enters the same terminal state before external cleanup.
export class AudioVoice {
  private finished = false;
  private cancellation?: { signal: AbortSignal; handler: () => void };
  constructor(
    readonly source: AudioBufferSourceNode,
    readonly gain: GainNode,
    readonly world: boolean,
    readonly critical: boolean,
    readonly loop: boolean,
    private readonly lease: AudioBufferLease,
    private readonly remove: (voice: AudioVoice) => void,
    private readonly report: (error: unknown) => void,
  ) {
    source.onended = this.complete;
  }
  private complete = () => {
    try {
      this.finish();
    } catch (error) {
      this.report(error);
    }
  };
  cancelWith(signal: AbortSignal | undefined) {
    if (!signal || this.finished) return;
    const handler = this.complete;
    this.cancellation = { signal, handler };
    signal.addEventListener('abort', handler, { once: true });
    if (signal.aborted) handler();
  }
  finish = () => {
    if (this.finished) return;
    this.finished = true;
    this.source.onended = null;
    const cancellation = this.cancellation;
    this.cancellation = undefined;
    this.remove(this);
    cleanupAll([
      () => cancellation?.signal.removeEventListener('abort', cancellation.handler),
      () => {
        try {
          this.source.stop();
        } catch {
          /* already ended or never started */
        }
      },
      () => this.source.disconnect(),
      () => this.gain.disconnect(),
      () => this.lease.release(),
    ]);
  };
}
