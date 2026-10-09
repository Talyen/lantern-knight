import { openPreview } from './preview-session';
import { untilInterrupted } from './run-process';
const session = await openPreview({
  output: 'built',
  assets: 'pinned',
  scope: 'runtime',
  port: Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
});
try {
  console.log(session.origin);
  await untilInterrupted();
} finally {
  await session.close();
}
