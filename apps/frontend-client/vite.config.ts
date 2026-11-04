import { minimal2023Preset } from '@vite-pwa/assets-generator/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

import rootPackage from '../../package.json' with { type: 'json' };

/** Where the hub runs in development: the app talks to it through this server, as from the same origin. */
const hub = process.env['HUB_URL'] ?? 'http://localhost:3000';
/** The origin the hub knows itself by (its PUBLIC_URL): in Docker the address it is reached at differs. */
const hubOrigin = process.env['HUB_ORIGIN'] ?? hub;
/** The page of Ayu Dark: the tile of the icon and the screen the installed app opens on. */
const iconBackground = '#0b0e14';

export default defineConfig({
  plugins: [
    react(),
    // The app installs: its icons are drawn at build from the logo, the worker keeps the built files and
    // takes a new release by itself. The API is not kept: it always goes to the network.
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: {
        image: 'public/logo.svg',
        preset: {
          ...minimal2023Preset,
          // The tile fills the icon the system cuts: a maskable one keeps the letter in its safe zone.
          maskable: {
            ...minimal2023Preset.maskable,
            padding: 0.2,
            resizeOptions: { background: iconBackground },
          },
          apple: {
            ...minimal2023Preset.apple,
            padding: 0,
            resizeOptions: { background: iconBackground },
          },
        },
        // The page states the colour of each scheme itself.
        injectThemeColor: false,
      },
      // The names of the manifest are of its specification, in snake_case.
      /* eslint-disable @typescript-eslint/naming-convention */
      manifest: {
        id: '/app/',
        name: 'Нищебродская - трекер цен',
        short_name: 'Нищебродская',
        description: 'Трекер цен на маркетплейсах',
        lang: 'ru',
        start_url: '/app/',
        // The whole host: the sign-in through a provider comes back to /auth/..., and stays in the app window.
        scope: '/',
        display: 'standalone',
        theme_color: iconBackground,
        background_color: iconBackground,
      },
      /* eslint-enable @typescript-eslint/naming-convention */
      workbox: { globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico}'] },
    }),
  ],
  // The version of the release, which the root package.json holds: the page shows it. The constant is
  // named in capitals, like the other build-time constants.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  define: { APP_VERSION: JSON.stringify(rootPackage.version) },
  // The hub serves the built app under this path.
  base: '/app/',
  server: {
    port: 5174,
    proxy: Object.fromEntries(
      ['/auth', '/products', '/product-groups', '/marketplaces'].map((path): [string, object] => [
        path,
        // The hub checks where a write comes from: the app in development says it is the hub itself.
        { target: hub, headers: { origin: hubOrigin } },
      ]),
    ),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    restoreMocks: true,
  },
});
