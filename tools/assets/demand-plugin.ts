import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export function demandArtworkPlugin(
  publicDirectory: string,
  ensure: (relative: string) => Promise<boolean>,
): Plugin {
  return {
    name: 'lantern-demand-artwork',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = (req.url ?? '').split('?')[0]!;
        let relative: string;
        try {
          relative = decodeURIComponent(raw.slice(1));
        } catch {
          res.statusCode = 400;
          res.end('Invalid artwork path');
          return;
        }
        if (
          !/^(generated|lighting|visual-effects|dev-effects|animation|decoders|media|audio)\//.test(
            relative,
          ) &&
          !['build-mode.json', 'registration.json'].includes(relative)
        )
          return next();
        void (async () => {
          if (!(await ensure(relative))) {
            res.statusCode = 404;
            res.end('Artwork is absent from the pinned inventory');
            return;
          }
          // Vite inventories publicDir at startup. Newly acquired files must be
          // served here rather than falling through to its HTML fallback.
          const file = path.join(publicDirectory, relative),
            stat = await fs.stat(file);
          const types: Record<string, string> = {
            '.json': 'application/json',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.ktx2': 'image/ktx2',
            '.wasm': 'application/wasm',
            '.js': 'text/javascript',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
          };
          res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Accept-Ranges', 'bytes');
          const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
          const start = range ? Number(range[1]) : 0;
          const end = range?.[2] ? Number(range[2]) : stat.size - 1;
          if (range && (start > end || end >= stat.size)) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${stat.size}`);
            res.end();
            return;
          }
          if (range) {
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          }
          res.setHeader('Content-Length', end - start + 1);
          if (req.method === 'HEAD' || stat.size === 0) {
            res.end();
            return;
          }
          const stream = createReadStream(file, { start, end });
          res.on('close', () => stream.destroy());
          stream.on('error', (error) => res.destroy(error));
          stream.pipe(res);
        })().catch((error: unknown) => {
          console.error(error);
          if (res.destroyed) return;
          if (res.headersSent) res.destroy();
          else {
            res.statusCode = 503;
            res.end('Artwork could not be loaded. Retry the request.');
          }
        });
      });
    },
  };
}
