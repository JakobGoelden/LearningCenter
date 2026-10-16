import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-only file API for one pack folder, so the file bridge works in every
 * browser during `npm run dev`. Enable with LC_PACK_DIR=path/to/pack.
 * Not part of the static build.
 */
export function packFs(): Plugin {
  return {
    name: 'learningcenter-pack-fs',
    apply: 'serve',
    configureServer(server) {
      const dirArg = process.env.LC_PACK_DIR;
      if (!dirArg) return;
      const root = resolve(dirArg);
      server.config.logger.info(`  ➜  Pack folder: ${root}`);

      const inside = (p: string) => {
        const abs = resolve(root, p);
        const rel = relative(root, abs);
        if (!p || !rel || rel.startsWith('..') || isAbsolute(rel)) {
          throw Object.assign(new Error('path outside pack'), { status: 400 });
        }
        return abs;
      };
      const body = (req: import('node:http').IncomingMessage) =>
        new Promise<string>((ok, fail) => {
          let data = '';
          req.setEncoding('utf8');
          req.on('data', (c) => (data += c));
          req.on('end', () => ok(data));
          req.on('error', fail);
        });

      server.middlewares.use('/__lc/fs', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          const op = url.pathname.replace(/^\//, '');
          if (op === 'info') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ dir: relative(process.cwd(), root) || root }));
            return;
          }
          const path = url.searchParams.get('path') ?? '';
          const abs = op === 'list' && path === '' ? root : inside(path);
          switch (op) {
            case 'read':
              res.end(await readFile(abs, 'utf8'));
              return;
            case 'write':
              await mkdir(dirname(abs), { recursive: true });
              await writeFile(abs, await body(req), 'utf8');
              res.end('ok');
              return;
            case 'append':
              await mkdir(dirname(abs), { recursive: true });
              await appendFile(abs, await body(req), 'utf8');
              res.end('ok');
              return;
            case 'remove':
              await rm(abs, { force: true });
              res.end('ok');
              return;
            case 'list': {
              const entries = await readdir(abs, { withFileTypes: true });
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify(entries.filter((e) => e.isFile()).map((e) => e.name).sort()));
              return;
            }
            case 'mtime':
              res.end(String((await stat(abs)).mtimeMs));
              return;
            default:
              res.statusCode = 400;
              res.end('unknown op');
          }
        } catch (e) {
          const err = e as NodeJS.ErrnoException & { status?: number };
          res.statusCode = err.code === 'ENOENT' ? 404 : (err.status ?? 500);
          res.end(err.message);
        }
      });
    },
  };
}
