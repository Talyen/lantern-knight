// Content is plain structured data. Drafts remain caller-owned; accepted snapshots
// are detached before freezing so validation cannot be invalidated by later edits.
export type ContentSnapshot<T> = T extends object
  ? { readonly [K in keyof T]: ContentSnapshot<T[K]> }
  : T;
export function contentSnapshot<T>(draft: T): ContentSnapshot<T> {
  const snapshot = structuredClone(draft);
  const freeze = (value: unknown) => {
    if (value === null || typeof value !== 'object') return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(snapshot);
  return snapshot as ContentSnapshot<T>;
}

// Borrow selected live properties without exposing the owner's command surface.
export function borrowedView<T, K extends keyof T, M extends object>(
  owner: T,
  keys: readonly K[],
  methods: M,
): Readonly<Pick<T, K> & M> {
  return Object.freeze(
    Object.defineProperties(
      { ...methods },
      Object.fromEntries(keys.map((key) => [key, { enumerable: true, get: () => owner[key] }])),
    ),
  ) as Readonly<Pick<T, K> & M>;
}
