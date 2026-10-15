import { CleanupFailure, cleanupAll, cleanupAfterFailure } from './cleanup';

// A batch owns completed acquisitions until transfer. Cancellation releases them
// immediately, while every unfinished acquisition remains observed through cleanup.
export async function acquireBatch<T>(
  ids: Iterable<string>,
  load: (id: string, signal: AbortSignal) => Promise<T>,
  destroy: (value: T) => void,
  signal?: AbortSignal,
  progress?: (done: number, total: number) => void,
  retire?: () => void,
) {
  signal?.throwIfAborted();
  const selected = [...new Set(ids)],
    failure = new AbortController(),
    lifetime = AbortSignal.any([failure.signal, ...(signal ? [signal] : [])]),
    values = new Map<string, T>(),
    cleanupErrors: unknown[] = [];
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    cleanupAll([...values.values()].map((value) => () => destroy(value)));
  };
  const cancel = () => {
    try {
      cleanupAll([release, ...(retire ? [retire] : [])]);
    } catch (error) {
      cleanupErrors.push(error);
    }
  };
  lifetime.addEventListener('abort', cancel, { once: true });
  try {
    await Promise.allSettled(
      selected.map(async (id) => {
        try {
          lifetime.throwIfAborted();
          const value = await load(id, lifetime);
          if (released) {
            try {
              destroy(value);
            } catch (error) {
              cleanupErrors.push(error);
            }
          } else {
            values.set(id, value);
            progress?.(values.size, selected.length);
          }
        } catch (error) {
          if (!lifetime.aborted) failure.abort(error);
          else if (error instanceof CleanupFailure) cleanupErrors.push(error);
        }
      }),
    );
    if (lifetime.aborted) {
      const reason = lifetime.reason;
      throw reason instanceof DOMException && reason.name === 'AbortError'
        ? new Error('load cancelled')
        : reason;
    }
    return { resources: new Map(selected.map((id) => [id, values.get(id)!])), release };
  } catch (error) {
    cleanupAfterFailure(error, () =>
      cleanupAll([
        release,
        ...cleanupErrors.map((failure) => () => {
          throw failure;
        }),
      ]),
    );
  } finally {
    lifetime.removeEventListener('abort', cancel);
  }
}
