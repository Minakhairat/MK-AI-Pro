import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function resolveBasePath(): string {
  const raw = (process.env.VITE_BASE_PATH || '/').trim();
  if (!raw || raw === '/') return '/';
  if (raw === './' || raw === '.') return './';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export default defineConfig(() => {
  const basePath = resolveBasePath();
  const isElectronBuild = process.env.ELECTRON_BUILD === 'true';

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      ...(!isElectronBuild
        ? [
            VitePWA({
              registerType: 'prompt',
              includeAssets: [
                'icon.svg',
                'apple-touch-icon.png',
                'pwa-192x192.png',
                'pwa-512x512.png',
                'pwa-maskable-512x512.png',
              ],
              manifest: {
                id: basePath,
                name: 'MK AI — by MK Tech',
                short_name: 'MK AI',
                description:
                  'Computer Vision AI Model Training, Mobile Dataset Studio & Standalone PWA Platform by MK Tech.',
                theme_color: '#DC2626',
                background_color: '#09090B',
                display: 'standalone',
                display_override: ['standalone', 'minimal-ui'],
                orientation: 'any',
                categories: ['developer', 'productivity', 'utilities'],
                start_url: basePath,
                scope: basePath,
                icons: [
                  {
                    src: 'pwa-192x192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: 'pwa-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: 'pwa-maskable-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
                shortcuts: [
                  {
                    name: 'New AI Project',
                    short_name: 'New Project',
                    description: 'Create a new Computer Vision project',
                    url: `${basePath}?action=new-project`,
                    icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
                  },
                  {
                    name: 'Camera Capture & Annotate',
                    short_name: 'Capture',
                    description: 'Capture dataset images and label bounding boxes on mobile',
                    url: `${basePath}?mobileTab=capture`,
                    icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
                  },
                  {
                    name: 'Training Monitor',
                    short_name: 'Training',
                    description: 'Check active training jobs and metrics',
                    url: `${basePath}?mobileTab=train`,
                    icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
                  },
                ],
              },
              workbox: {
                cleanupOutdatedCaches: true,
                clientsClaim: true,
                maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
                navigateFallback: `${basePath === './' ? '' : basePath}index.html`,
                navigateFallbackDenylist: [/^\/api\//, /\/__\/auth\//],
                runtimeCaching: [
                  {
                    urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
                    handler: 'NetworkOnly',
                  },
                  {
                    urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'google-fonts-cache',
                      expiration: {
                        maxEntries: 10,
                        maxAgeSeconds: 60 * 60 * 24 * 365,
                      },
                      cacheableResponse: {
                        statuses: [0, 200],
                      },
                    },
                  },
                  {
                    urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'gstatic-fonts-cache',
                      expiration: {
                        maxEntries: 10,
                        maxAgeSeconds: 60 * 60 * 24 * 365,
                      },
                      cacheableResponse: {
                        statuses: [0, 200],
                      },
                    },
                  },
                ],
              },
              devOptions: {
                enabled: true,
                type: 'module',
              },
            }),
          ]
        : [
            {
              name: 'electron-pwa-noop-stub',
              resolveId(id: string) {
                if (id === 'virtual:pwa-register') return '\0virtual:pwa-register';
                return null;
              },
              load(id: string) {
                if (id === '\0virtual:pwa-register') {
                  return 'export function registerSW() { return async () => {}; }';
                }
                return null;
              },
            },
          ]),
      // Copies src/assets into dist/ and creates 404.html SPA fallback for GitHub Pages.
      {
        name: 'copy-unbundled-src-assets-and-gh-pages-fallback',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
          const indexHtml = path.join(distDir, 'index.html');
          const fallback404 = path.join(distDir, '404.html');
          if (fs.existsSync(indexHtml)) {
            fs.copyFileSync(indexHtml, fallback404);
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
