// Acquisition owners distinguish cleanup failures from expected cancellation.
export class CleanupFailure extends AggregateError {}

// Synchronous resource owners close admission before entering this boundary.
// Preserve dependency order while attempting every sibling cleanup exactly once.
export function cleanupAll(actions: Iterable<() => void>): void {
  const errors: unknown[] = [];
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new CleanupFailure(errors, 'Resource cleanup failed');
}

// Preserve the operation failure when unwinding its owned resources also fails.
export function cleanupAfterFailure(error: unknown, cleanup: () => void): never {
  try {
    cleanup();
  } catch (cleanupError) {
    throw new CleanupFailure([error, cleanupError], 'Operation and resource cleanup failed', {
      cause: error,
    });
  }
  throw error;
}
