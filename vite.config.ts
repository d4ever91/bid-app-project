import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
// Just the slice of http-proxy's API used below (avoids depending on @types/node).
type ProxyError = Error & { code?: string };
type ProxyResponse = { headersSent?: boolean; writeHead?: (status: number, headers: Record<string, string>) => void; end: (body?: string) => void };
type ProxyServer = { on(event: 'error', cb: (err: ProxyError, req: unknown, res: ProxyResponse) => void): void };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Where the Express API runs. The dev server forwards /api there, so the browser
  // only ever talks to http://localhost:5173 and no CORS setup is needed in development.
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:4000';

  // When the API isn't running, Vite's proxy would answer with an empty 500 and the app could
  // only say "Request failed". Reply in the API's own envelope with an actionable message.
  const proxy = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
      configure(server: ProxyServer) {
        server.on('error', (err, _req, res) => {
          if (!res.writeHead || res.headersSent) return;
          const down = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND';
          const message = down
            ? `The API server isn't running at ${apiTarget}. Start it with \`npm run dev\` (starts both) or \`npm run api\`.`
            : `The API server at ${apiTarget} didn't respond (${err.code ?? err.message}).`;
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, data: null, message, error: { code: 'API_UNREACHABLE', message } }));
        });
      }
    }
  };

  return {
    plugins: [svelte()],
    server: {
      port: 5173,
      strictPort: true,
      proxy
    },
    preview: {
      port: 4173,
      proxy
    }
  };
});
