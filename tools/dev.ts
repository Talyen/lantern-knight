import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { untilInterrupted } from './run-process';
import { openPreview } from './preview-session';

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      pinned: { type: 'boolean' },
      open: { type: 'boolean' },
      runtime: { type: 'boolean' },
    },
  });
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('Invalid development port');
  const session = await openPreview({
    output: 'development',
    assets: values.pinned ? 'pinned' : 'local',
    scope: values.runtime ? 'runtime' : 'authoring',
    port: port ?? Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
    open: values.open,
  });
  try {
    console.log(session.origin);
    console.log(
      'Game /index.html · Sandbox /sandbox.html · Editor /editor.html · Effects /effects.html',
    );
    await untilInterrupted();
  } finally {
    await session.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
