// Stop admission on failure, but retain staging and leases until every admitted
// transfer settles. A fail-fast Promise.all would let cleanup race live uploads.
export async function publicationWork<T>(
  values: readonly T[],
  work: (value: T) => Promise<void>,
  concurrency = 3,
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error('Invalid publication concurrency');
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (!failed && next < values.length) {
        const value = values[next++]!;
        try {
          await work(value);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw failure;
}
