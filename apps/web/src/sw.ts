/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

// Updates are silent: the new worker takes over at once, old caches go away.
self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The build's files are kept for offline start. Precached entries carry a revision, so a deploy replaces them.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Network first for pages: after a deploy, new HTML and new scripts arrive together. Offline (or after 4 s)
// the cached app shell answers. API calls and the health check are never cached.
registerRoute(
  new NavigationRoute(new NetworkFirst({ cacheName: `pages-${__APP_VERSION__}`, networkTimeoutSeconds: 4 }), {
    denylist: [/^\/api\//, /^\/healthz/, /^\/k\//],
  }),
);
