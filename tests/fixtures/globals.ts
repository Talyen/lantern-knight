import type { TestContext } from 'node:test';

export function mockGlobals(t: Pick<TestContext, 'after'>, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
}
