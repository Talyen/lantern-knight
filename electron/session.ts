import type { LaunchMode } from './launch';
import type { Store } from './store';
import type { Slot, StoredValues } from '../src/platform/storage-codec';
import type { LoadResult } from '../src/platform/bridge';

type Profile = Pick<Store, 'load' | 'save' | 'drain'>;
type CurrentProfile = { mode: LaunchMode; store: Profile };
type Phase = 'active' | 'draining' | 'navigating' | 'unavailable';

// Navigation and storage admission share one owner. The destination may read
// settings while loading; main authenticates it against this owner's mode.
export class DesktopSession {
  private current: CurrentProfile;
  private phase: Phase = 'unavailable';
  private changing = false;
  private closed = false;
  constructor(
    initial: LaunchMode,
    private readonly storeFor: (mode: LaunchMode) => Profile,
    private readonly navigate: (mode: LaunchMode) => Promise<void>,
  ) {
    this.current = { mode: initial, store: storeFor(initial) };
  }
  get mode() {
    return this.current.mode;
  }
  private checkLifetime() {
    if (this.closed) throw new Error('Desktop session disposed');
  }
  private storage(slot: Slot) {
    this.checkLifetime();
    if (this.phase !== 'active' && this.phase !== 'navigating')
      throw new Error('Desktop profile is not available');
    if (slot === 'game' && this.mode !== 'game') return undefined;
    return this.current.store;
  }
  load<S extends Slot>(slot: S): Promise<LoadResult<StoredValues[S]>> {
    return this.storage(slot)?.load(slot) ?? Promise.resolve({ status: 'empty' });
  }
  save(slot: Slot, value: unknown) {
    const store = this.storage(slot);
    if (!store) throw new Error('Sandbox checkpoint writes denied');
    return store.save(slot, value);
  }
  async launch(next: LaunchMode) {
    this.checkLifetime();
    if (this.changing) throw new Error('Desktop launch in progress');
    if (this.phase === 'active' && next === this.mode) return;
    const previous = this.current,
      wasActive = this.phase === 'active';
    this.changing = true;
    this.phase = 'draining';
    let navigating = false;
    try {
      // Close admission before capturing the queue. No later IPC can extend it.
      await previous.store.drain();
      this.checkLifetime();
      this.current = { mode: next, store: this.storeFor(next) };
      this.phase = 'navigating';
      navigating = true;
      await this.navigate(next);
      this.checkLifetime();
      this.phase = 'active';
    } catch (error) {
      if (this.closed) throw error;
      this.phase = 'draining';
      try {
        if (navigating) await this.current.store.drain();
        this.checkLifetime();
        this.current = previous;
        if (navigating && wasActive) {
          this.phase = 'navigating';
          await this.navigate(previous.mode);
          this.checkLifetime();
        }
        this.phase = wasActive ? 'active' : 'unavailable';
      } catch (recovery) {
        this.phase = 'unavailable';
        throw new AggregateError([error, recovery], 'Desktop launch and recovery failed', {
          cause: error,
        });
      }
      throw error;
    } finally {
      this.changing = false;
    }
  }
  dispose() {
    this.closed = true;
    this.phase = 'unavailable';
  }
}
