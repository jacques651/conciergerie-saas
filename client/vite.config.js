import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';

// HTTPS obligatoire pour le GPS (navigator.geolocation) et pour le service worker hors localhost.
// Certificat auto-signé de développement dans client/certs/ (valable pour localhost,
// 127.0.0.1 et 192.168.100.235). Le navigateur affiche un avertissement à accepter une fois.
// Si les certificats sont absents, Vite démarre en HTTP (le GPS ne marchera qu'en localhost).
const certDir = path.resolve(__dirname, 'certs');
const keyFile = path.join(certDir, 'key.pem');
const certFile = path.join(certDir, 'cert.pem');
const https = fs.existsSync(keyFile) && fs.existsSync(certFile)
  ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
  : undefined;

// Couleurs du thème Vert-ardoise (barre d'état et écran de démarrage de l'application installée)
const THEME_COLOR = '#0f766e';      // --tk-accent-700
const BACKGROUND_COLOR = '#071114'; // fond sombre du cadre (--tk-grad-dark)

export default defineConfig({
  plugins: [
    react(),
    // ---------- PWA : manifeste + service worker (mise à jour automatique) ----------
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/favicon-64x64.png', 'icons/apple-touch-icon-180x180.png', 'aide/*.webp'],
      manifest: {
        id: '/',
        name: 'Conciergerie de Quartier',
        short_name: 'Conciergerie',
        description: 'Coordination des livreurs de quartier : carte en temps réel, missions, messagerie.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        categories: ['business', 'productivity', 'navigation'],
        icons: [
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webp}'],
        // L'API et le temps réel ne passent JAMAIS par le cache (données toujours fraîches)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        runtimeCaching: [
          {
            // Tuiles OpenStreetMap : cache limité pour une carte plus rapide (et utilisable brièvement hors ligne)
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      // Service worker aussi en développement (npm run dev) pour tester l'installation
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' }
    })
  ],
  // Variables VITE_* lues dans client/ (.env, .env.production) ; sur Vercel : variables du projet
  envDir: __dirname,
  server: {
    port: 5173,
    host: true, // accessible depuis le réseau local (https://192.168.100.235:5173)
    https,
    // Proxy : /api et /socket.io transmis au backend HTTP (port 4000)
    // → pas de CORS, pas de « contenu mixte » HTTPS/HTTP
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true, changeOrigin: true }
    }
  },
  // `npm run preview` : même proxy et même HTTPS pour tester la version de production
  preview: {
    port: 4173,
    host: true,
    https,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true, changeOrigin: true }
    }
  }
});
