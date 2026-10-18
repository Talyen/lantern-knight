// Bound filesystem admission and drain failed batches before callers release leases.
export async function forEachFile<T>(files: readonly T[], action: (file: T) => Promise<unknown>) {
  for (let offset = 0; offset < files.length; offset += 64) {
    const results = await Promise.allSettled(
      files.slice(offset, offset + 64).map(async (file) => action(file)),
    );
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
}
