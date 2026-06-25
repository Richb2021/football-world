import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/football-world/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');

          if (normalized.includes('/node_modules/three/')) return 'vendor-three';
          if (normalized.includes('/node_modules/@supabase/')) return 'vendor-supabase';
          if (
            normalized.includes('/src/game/matchRunner.ts')
            || normalized.includes('/src/engine/matchRenderer.ts')
            || normalized.includes('/src/engine/stadium.ts')
            || normalized.includes('/src/engine/playerVisuals.ts')
            || normalized.includes('/src/sim/matchSim.ts')
            || normalized.includes('/src/sim/phase.ts')
          ) {
            return 'match-engine';
          }

          if (normalized.includes('/src/data/teams/')) return 'teams-data';
          if (
            normalized.includes('/src/journey/episodes/')
            || normalized.includes('/src/journey/journeyGame.ts')
            || normalized.includes('/src/journey/sceneRenderer.ts')
            || normalized.includes('/src/journey/storyNarrative.ts')
          ) {
            return 'story-mode';
          }
          if (
            normalized.includes('/src/ui/stars/')
            || (normalized.includes('/src/game/stars/') && !normalized.includes('/src/game/stars/journeyReward.ts'))
          ) {
            return 'stars-mode';
          }
          // Manager / Player Career / Customisation intentionally bundle into the
          // main app chunk: they cross-import the shared stars UI helpers, so giving
          // them separate chunks created circular-chunk warnings.
        },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png', 'assets/ui/*.png'],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // When this SW activates, delete precaches left by any previous version —
        // critically the old ~68 MB png precache — so a returning player isn't stuck
        // serving stale/corrupt cached assets after an update.
        cleanupOutdatedCaches: true,
        // Precache ONLY the app shell (JS/CSS/HTML/fonts/manifest). The heavy media —
        // 3D models (.glb), pitch/stadium textures and art (.webp/.png/.jpg) and audio
        // (.mp3) — is cached on demand at runtime instead. Precaching it all produced a
        // ~68 MB service-worker install that can stall or fail on a phone; worse, the
        // match textures are .webp and were matched by NEITHER the old png-only precache
        // NOR the old mp3|glb runtime rule, so on the deployed PWA the pitch loaded with
        // no textures/models — a blank scene that reads as a hang. CacheFirst below keeps
        // every asset available offline after its first load.
        globPatterns: ['**/*.{js,css,html,json,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // every binary media type the game loads at runtime (models, textures,
            // art, audio) — note webp/gltf, which the old rule missed
            urlPattern: /\.(?:mp3|ogg|wav|glb|gltf|bin|webp|png|jpg|jpeg)(?:\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'media-assets',
              expiration: {
                maxEntries: 6000,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Football World',
        short_name: 'Football World',
        description: 'Manager, Player Career and Customisation football — build your football world',
        theme_color: '#0b1f12',
        background_color: '#0b1f12',
        display: 'standalone',
        orientation: 'landscape',
        start_url: './',
        icons: [
          { src: 'icons/icon-192.png?v=4', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png?v=4', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png?v=4', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
