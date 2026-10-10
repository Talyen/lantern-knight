import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runProcess, untilInterrupted } from './run-process';
import { openPreview } from './preview-session';

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      pinned: { type: 'boolean' },
      open: { type: 'boolean' },
      runtime: { type: 'boolean' },
      preview: { type: 'boolean' },
    },
  });
  if (values.preview && process.platform !== 'darwin')
    throw new Error('Safari preview launch requires macOS; use npm run dev on this platform.');
  if (values.preview && values.runtime) throw new Error('Dev Preview requires authoring assets.');
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('Invalid development port');
  const session = await openPreview({
    output: 'development',
    assets: values.pinned ? 'pinned' : 'local',
    scope: values.runtime ? 'runtime' : 'authoring',
    port: port ?? Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
    open: values.preview ? false : values.open,
    reuse: values.preview,
  });
  try {
    if (values.preview) {
      const url = session.origin + '/sandbox.html';
      await runProcess('open', ['-a', 'Safari', url], {
        cwd: path.dirname(fileURLToPath(import.meta.url)),
      });
      console.log('Dev Preview in Safari: ' + url);
    }
    console.log(session.origin);
    console.log(
      values.runtime
        ? 'Game /index.html'
        : 'Game /index.html · Dev Preview /sandbox.html · Editor /editor.html · Effects /effects.html',
    );
    if (session.ownsServer) await untilInterrupted();
  } finally {
    await session.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
