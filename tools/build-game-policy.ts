import fs from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { gameRegistration } from './build-runtime-delivery';

export function gamePolicyPlugin(ensure?: (file: string) => Promise<boolean>): Plugin {
  let cached: { key: string; value: ReturnType<typeof gameRegistration> } | undefined;
  let pending: Promise<ReturnType<typeof gameRegistration>> | undefined;
  return {
    name: 'lantern-game-registration',
    configureServer(server) {
      const publicDirectory = server.config.publicDir;
      const projection = async () => {
        const content = (await server.ssrLoadModule(
          '/src/content/game-content.ts',
        )) as typeof import('../src/content/game-content');
        await ensure?.('build-mode.json');
        const policy = await fs.readFile(path.join(publicDirectory, 'build-mode.json'));
        const assets = Object.keys(content.gameAssetCatalog).sort(),
          key = policy.toString() + JSON.stringify(assets);
        if (cached?.key === key) return cached.value;
        await ensure?.('registration.json');
        const value = gameRegistration(
          await fs.readFile(path.join(publicDirectory, 'registration.json')),
          policy,
          assets,
        );
        cached = { key, value };
        return value;
      };
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url !== '/game-build-mode.json' && url !== '/game-registration.json') return next();
        pending ??= projection().finally(() => {
          pending = undefined;
        });
        void pending.then((result) => {
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-store');
          res.end(
            url === '/game-registration.json'
              ? result.registration
              : JSON.stringify({ ...result.policy, registrationUrl: '/game-registration.json' }),
          );
        }, next);
      });
    },
  };
}
