import type { TestContext } from 'node:test';

type Scope = Pick<TestContext, 'after'>;
const originals = new WeakMap<Scope, Map<string, PropertyDescriptor | undefined>>();

export function mockGlobals(t: Scope, values: Record<string, unknown>) {
  const saved = originals.get(t) ?? new Map<string, PropertyDescriptor | undefined>();
  if (!originals.has(t)) {
    originals.set(t, saved);
    t.after(() => {
      for (const [key, previous] of saved) {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
      }
      originals.delete(t);
    });
  }
  for (const [key, value] of Object.entries(values)) {
    if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
}
