import { Readable } from 'node:stream';
import { spec, type TestEvent } from 'node:test/reporters';

/** @knip-external Loaded by Node's --test-reporter option. */
export default async function* concise(source: AsyncIterable<TestEvent>) {
  async function* selected() {
    for await (const event of source) {
      if (event.type === 'test:start') continue;
      if (event.type === 'test:pass' && !event.data.skip && !event.data.todo) continue;
      yield event;
    }
  }
  yield* Readable.from(selected()).pipe(new spec());
}
