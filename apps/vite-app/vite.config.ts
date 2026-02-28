import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Inline Lifo proxy middleware
    {
      name: 'lifo-proxy',
      configureServer(server) {
        let portRegistry: Map<number, any> | null = null;

        // Expose registration function
        (globalThis as any).__registerLifoPortRegistry = (registry: Map<number, any>) => {
          portRegistry = registry;
          console.log('[Lifo Proxy] Port registry registered, ports:', Array.from(registry.keys()));
        };

        // Add proxy middleware
        server.middlewares.use((req, res, next) => {
          const match = req.url?.match(/^\/proxy\/(\d+)(\/.*)?$/);
          if (!match) return next();

          const port = parseInt(match[1], 10);
          const path = match[2] || '/';

          console.log(`[Lifo Proxy] ${req.method} /proxy/${port}${path}`);

          if (!portRegistry) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Lifo not loaded. Open http://localhost:5173 and click "HTTP Server"\n');
            return;
          }

          const handler = portRegistry.get(port);
          if (!handler) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'text/plain');
            res.end(`No server on port ${port}. Available: ${Array.from(portRegistry.keys()).join(', ') || 'none'}\n`);
            return;
          }

          // Collect body
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', () => {
            const vReq = {
              method: req.method || 'GET',
              url: path,
              headers: req.headers as Record<string, string>,
              body: Buffer.concat(chunks).toString(),
            };
            const vRes = { statusCode: 200, headers: {} as Record<string, string>, body: '' };

            try {
              handler(vReq, vRes);
              res.statusCode = vRes.statusCode;
              Object.entries(vRes.headers).forEach(([k, v]) => res.setHeader(k, v));
              res.end(vRes.body);
              console.log(`[Lifo Proxy] ${vRes.statusCode} sent`);
            } catch (error: any) {
              res.statusCode = 500;
              res.end(`Error: ${error.message}\n`);
            }
          });
        });

        console.log('[Lifo Proxy] Middleware ready at /proxy/PORT/');
      },
    },
  ],
  resolve: {
    alias: {
      '@lifo-sh/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
});
