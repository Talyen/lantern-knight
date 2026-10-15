import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Importable commands share one entry check and one synchronous/asynchronous error boundary.
export function runCli(
  url: string,
  work: (args: string[]) => unknown,
  report: 'error' | 'message' = 'error',
) {
  if (!process.argv[1] || path.resolve(process.argv[1]) !== fileURLToPath(url)) return;
  Promise.resolve()
    .then(() => work(process.argv.slice(2)))
    .catch((error: unknown) => {
      console.error(report === 'message' && error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
