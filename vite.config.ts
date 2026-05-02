import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const isGitHubPages = process.env.GITHUB_PAGES === 'true';
  const isProd = mode === 'production';
  return {
    base: isGitHubPages ? '/Gen_AI_APAC/' : '/',
    plugins: [
      react(),
      tailwindcss(),
      // Emit dist/stats.html with a treemap view of the production bundle.
      // Generated only on `vite build` (the plugin no-ops in dev) so the
      // `npm run analyze` script can open it for sizing investigation.
      visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY),
      'process.env.GOOGLE_API_KEY': JSON.stringify(env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    esbuild: {
      // Drop console.log / debugger in production builds, but keep
      // console.error and console.warn so genuine errors still reach
      // the browser console (and any logging endpoints) in production.
      drop: isProd ? ['debugger'] : [],
      pure: isProd ? ['console.log', 'console.debug', 'console.info'] : [],
    },
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      sourcemap: !isProd,
      // Each lazy route already produces its own chunk; the warning
      // limit here is only about the largest stable vendor chunks.
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          // Stable, named vendor chunks so repeat visits hit cache and
          // pages don't redownload react/firebase/etc when navigating.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            // Match the package name in `node_modules/<name>` or
            // `node_modules/@scope/<name>` so chunking is robust to
            // pnpm/npm layouts.
            const parts = id.split('node_modules/')[1]?.split('/') ?? [];
            const pkg = parts[0]?.startsWith('@')
              ? `${parts[0]}/${parts[1] ?? ''}`
              : parts[0];
            if (!pkg) return undefined;

            if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-router-dom' || pkg === 'react-router' || pkg === 'scheduler') {
              return 'vendor-react';
            }
            if (pkg === '@firebase' || pkg === 'firebase' || pkg.startsWith('@firebase/')) {
              return 'vendor-firebase';
            }
            if (pkg === 'motion' || pkg === 'framer-motion') {
              return 'vendor-motion';
            }
            if (pkg === 'recharts' || pkg.startsWith('d3-') || pkg === 'victory-vendor' || pkg === 'recharts-scale') {
              return 'vendor-recharts';
            }
            if (pkg === 'react-markdown' || pkg === 'remark-gfm' || pkg === 'remark-parse' || pkg === 'micromark' || pkg.startsWith('micromark-') || pkg.startsWith('mdast-util-') || pkg.startsWith('hast-util-') || pkg.startsWith('unist-util-') || pkg === 'unified' || pkg === 'vfile' || pkg === 'bail' || pkg === 'is-plain-obj' || pkg === 'trough' || pkg === 'devlop' || pkg === 'decode-named-character-reference' || pkg === 'character-entities' || pkg === 'property-information') {
              return 'vendor-markdown';
            }
            if (pkg === 'lucide-react') {
              return 'vendor-icons';
            }
            if (pkg === '@google/genai' || pkg.startsWith('@google/')) {
              return 'vendor-gemini';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      port: 5000,
      host: '0.0.0.0',
      allowedHosts: true,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
      watch: {
        // Ignore the Python virtualenv too — without this, every
        // `pip install` triggers thousands of HMR reloads and vite's
        // css-analysis plugin can crash on in-flight `~dk` rename
        // artifacts left behind during package upgrades. The Python
        // server reloads independently via uvicorn's own watcher, so
        // there's no reason for vite to track these files.
        ignored: ['**/.local/**', '**/node_modules/**', '**/.git/**', '**/.pythonlibs/**'],
      },
      proxy: {
        // WebSocket bridge for the Live (Gemini Live) feature. Vite needs
        // `ws: true` to upgrade the connection — otherwise the browser sees
        // a plain HTTP request that hangs.
        '/ws': { target: 'ws://127.0.0.1:8000', ws: true, changeOrigin: true },
        '/api': 'http://127.0.0.1:8000',
        '/chat': 'http://127.0.0.1:8000',
        '/agent': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          selfHandleResponse: false,
          bypass: (req) => {
            // /agent (exact path, with or without query string) is the SPA
            // page — let it through on GET so React Router can handle it.
            const path = (req.url || '').split('?')[0];
            if (req.method === 'GET' && path === '/agent') return req.url;
            return null;
          },
          configure: (proxy) => {
            proxy.on('proxyReq', (_proxyReq, req) => {
              if (req.url?.includes('/stream')) {
                _proxyReq.setHeader('Accept', 'text/event-stream');
              }
            });
          },
        },
        // Routes that are BOTH SPA pages (GET nav) and API endpoints (fetch/POST/DELETE)
        // Only bypass to SPA when the browser is doing real page navigation (Accept: text/html).
        // JavaScript fetch() calls send Accept: */* and must be proxied to the backend.
        '/recall': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/capture': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/tasks': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/settings': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/flashcards': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        // SPA + API conflict pages — bypass to SPA only on real page nav
        '/revisits': { target: 'http://127.0.0.1:8000', bypass: (req) => { const path = (req.url || '').split('?')[0]; return (req.method === 'GET' && path === '/revisits' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null; } },
        '/notes': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/bookmarks': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/habits': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/share': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        // Pure API endpoints (no SPA page conflict)
        '/memories': 'http://127.0.0.1:8000',
        '/schedule': 'http://127.0.0.1:8000',
        '/stats': 'http://127.0.0.1:8000',
        '/logs': 'http://127.0.0.1:8000',
        '/health': 'http://127.0.0.1:8000',
        '/agents': 'http://127.0.0.1:8000',
        '/workflows': 'http://127.0.0.1:8000',
        '/export': 'http://127.0.0.1:8000',
        // Vault smart collections — pure API, no SPA page. Without this
        // proxy entry, dev requests fall through to the SPA fallback and
        // return index.html, which blows up `await r.json()` and surfaces
        // as "Could not save collection" toast on the Vault.
        '/smart-collections': 'http://127.0.0.1:8000',
        // Tag manager APIs — pure API, no SPA page conflict.
        '/tags-index': 'http://127.0.0.1:8000',
        '/tags': 'http://127.0.0.1:8000',
        // Library Trash tab — pure API.
        '/trash': 'http://127.0.0.1:8000',
        // W3 Universal Linker (Cmd-K palette) — pure API; /search and
        // /links have no SPA route so a plain proxy entry is enough.
        '/search': 'http://127.0.0.1:8000',
        '/links': 'http://127.0.0.1:8000',
        // W4 AI auto-link layer (P4B) — pure API namespaces, no SPA route.
        // Without these entries, fetches to /preferences/auto_link and
        // /suggestions/{links,inbox} fall through to the SPA fallback and
        // return index.html, which breaks `await r.json()` everywhere they
        // are called (Settings AI auto-link card, MemoryLinksPanel
        // suggestions, Daily Briefing AI Suggestions card).
        '/preferences': 'http://127.0.0.1:8000',
        '/suggestions': 'http://127.0.0.1:8000',
        // P5A — Notion integration endpoints. Without this entry, fetches
        // to /integrations/notion/* fall through to the SPA fallback and
        // return index.html, breaking JSON parsing in IntegrationsPage,
        // CapturePage and MemoryLinksPanel.
        '/integrations': 'http://127.0.0.1:8000',
        // /calendar is BOTH the SPA Calendar page (GET nav with text/html)
        // AND an API namespace (/calendar/topics, /calendar/events,
        // /calendar/import, /calendar/google/wizard). Bypass to SPA only on
        // bare /calendar page navigation.
        '/calendar': { target: 'http://127.0.0.1:8000', bypass: (req) => { const path = (req.url || '').split('?')[0]; return (req.method === 'GET' && path === '/calendar' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null; } },
        // /library is BOTH the SPA Library page (GET nav with text/html)
        // AND an API namespace (/library/counts, /library/bulk-*). Bypass
        // to SPA only on bare /library (or /library?... query string) page
        // navigation — every other shape proxies to FastAPI so the badge
        // counts JSON and bulk ops work in dev.
        '/library': { target: 'http://127.0.0.1:8000', bypass: (req) => { const path = (req.url || '').split('?')[0]; return (req.method === 'GET' && path === '/library' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null; } },
        // /briefing is BOTH the SPA Daily Briefing page (GET nav with text/html
        // Accept) and an API root with /briefing/list, /briefing/timeline,
        // /briefing/recap etc. Bypass to the SPA only on real page navigation
        // so deep-link / refresh on /briefing renders the React app.
        '/briefing': { target: 'http://127.0.0.1:8000', bypass: (req) => { const path = (req.url || '').split('?')[0]; return (req.method === 'GET' && path === '/briefing' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null; } },
        // /dashboard is BOTH an SPA page (GET nav) and an API root (/dashboard/advanced).
        // Bypass to SPA only on real page navigation (Accept: text/html on the bare path).
        '/dashboard': { target: 'http://127.0.0.1:8000', bypass: (req) => { const path = (req.url || '').split('?')[0]; return (req.method === 'GET' && path === '/dashboard' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null; } },
        '/study-plan': 'http://127.0.0.1:8000',
        '/plan': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/workspace': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/discover': { target: 'http://127.0.0.1:8000', bypass: (req) => (req.method === 'GET' && (req.headers['accept'] || '').includes('text/html')) ? req.url : null },
        '/calendar.ics': 'http://127.0.0.1:8000',
        '/test-ai': 'http://127.0.0.1:8000',
        '/config': 'http://127.0.0.1:8000',
      }
    },
  };
});
