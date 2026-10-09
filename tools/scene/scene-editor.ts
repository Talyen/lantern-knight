import { execFile } from 'node:child_process';
import { scenePreviewServer } from './scene-server';
async function main() {
  const server = await scenePreviewServer(),
    url = server.origin + '/editor.html';
  console.log(`Scene editor: ${url}`);
  execFile(
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open',
    [url],
    (error) => {
      if (error) console.log('Open the editor URL in your browser.');
    },
  );
  if (server.reused) return;
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await server.close();
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
