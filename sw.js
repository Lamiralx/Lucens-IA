/**
 * Service Worker Lucens IA — mode offline-first pour HACCP terrain.
 *
 * Objectif : l'app fonctionne hors-ligne pour TOUT sauf l'analyse Claude
 * (qui exige Anthropic). Les analyses lancées offline vont en queue locale
 * (géré par le code app, pas le SW) et partent au retour de connexion.
 *
 * Stratégies de cache :
 *   - App shell (HTML, CSS, JS principal) : cache-first avec fallback réseau
 *   - Assets statiques (fonts, libs CDN) : cache-first stale-while-revalidate
 *   - /api/* : NEVER cached (toujours réseau, échec géré par l'app)
 *
 * Versionning : bump CACHE_VERSION à chaque déploiement majeur pour purge propre.
 */

const CACHE_VERSION = 'lucens-v265-2026-06-10';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

/* URLs critiques à cacher au moment de l'installation.
   Si une de ces ressources échoue, l'install du SW échoue (volontairement
   conservateur : on veut être sûr que l'app marche offline après install). */
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/privacy.html',
];

/* URLs externes (CDN) qui sont chargées par index.html.
   On les cache aussi pour offline. Liste maintenue manuellement, à mettre
   à jour si les <script src> changent. */
const EXTERNAL_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
];

/* ─── INSTALL — pre-cache de l'app shell ────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      console.log('[SW] Pre-caching app shell');
      /* App shell : on bloque si échec (critique) */
      return cache.addAll(APP_SHELL_URLS).then(() => {
        /* External libs : best-effort (pas de blocage si CDN down) */
        return Promise.allSettled(
          EXTERNAL_LIBS.map((url) =>
            fetch(url, { mode: 'cors', credentials: 'omit' })
              .then((resp) => resp.ok ? cache.put(url, resp) : null)
              .catch((e) => console.warn('[SW] Cache CDN échoué:', url, e?.message))
          )
        );
      });
    }).then(() => self.skipWaiting())
  );
});

/* ─── ACTIVATE — purge des anciens caches versionnés ───────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => {
            console.log('[SW] Purge ancien cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
     /* V38 fix F-06 — Le force-reload brutal de V30 (c.navigate(c.url)) faisait
        perdre la saisie en cours sur le terrain HACCP. On notifie maintenant
        les clients via postMessage et c'est le code app qui décide d'afficher
        une bannière "Mise à jour disponible · Recharger" non-bloquante. */
     .then(() => self.clients.matchAll({ type: 'window' }))
     .then((clients) => clients.forEach((c) => {
       try {
         c.postMessage({ type: 'SW_UPDATE_AVAILABLE', version: CACHE_VERSION });
       } catch (e) {}
     }))
  );
});

/* ─── FETCH — stratégies par type de requête ───────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  /* Bypass : POST, PUT, DELETE, etc. — pas de cache pour mutations */
  if (req.method !== 'GET') return;

  /* /api/* — JAMAIS cacher. Toujours réseau. Échec géré côté app. */
  if (url.pathname.startsWith('/api/')) {
    /* On laisse passer la requête réseau telle quelle. Si elle échoue,
       l'app reçoit l'erreur fetch et peut basculer en mode queue offline. */
    return;
  }

  /* V18.1 — index.html en NETWORK-FIRST pour éviter qu'un cache navigateur
     périmé serve une version mojibake/buggy après un déploiement.
     Le HTML est petit (~1 Mo), le coût réseau est négligeable et la fraîcheur
     prévaut sur la perf brute. Le cache reste utilisé en fallback offline. */
  const isHtml = req.headers.get('accept')?.includes('text/html')
              || url.pathname === '/' || url.pathname.endsWith('.html');
  if (url.origin === self.location.origin && isHtml) {
    event.respondWith(networkFirst(req, APP_SHELL_CACHE));
    return;
  }

  /* Other same-origin (CSS, JS, images, manifest) — cache-first */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, APP_SHELL_CACHE));
    return;
  }

  /* External (CDN libs, fonts) — cache-first stale-while-revalidate */
  if (EXTERNAL_LIBS.includes(req.url) ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com' ||
      url.hostname === 'cdnjs.cloudflare.com' ||
      url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  /* Autres requêtes : réseau direct, pas de cache */
});

/* ─── V18.1 — Stratégie network-first : essaye réseau, fallback cache ────
   Pour le HTML : on veut TOUJOURS la dernière version déployée. Si offline
   ou réseau lent (timeout 3s), on retombe sur le cache. */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const controller = new AbortController();
    /* V156 — Timeout réseau porté à 6s (était 3s). Sur connexion mobile lente,
       3s déclenchait trop tôt le repli sur le cache → l'utilisateur restait sur
       l'ANCIENNE version en cache. Hors-ligne réel : le fetch échoue tout de
       suite (pas via ce timeout), donc le repli reste instantané. */
    const timer = setTimeout(() => controller.abort(), 6000);
    const fresh = await fetch(req, { signal: controller.signal });
    clearTimeout(timer);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    const fallback = await cache.match('/index.html');
    if (fallback) return fallback;
    return new Response('Offline et HTML non disponible en cache', {
      status: 503, statusText: 'Service Unavailable'
    });
  }
}

/* ─── Stratégie cache-first : essaye cache, fallback réseau ─────── */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    /* Offline + pas en cache → renvoie une réponse "offline" */
    if (req.headers.get('accept')?.includes('text/html')) {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline et ressource non disponible en cache', {
      status: 503, statusText: 'Service Unavailable'
    });
  }
}

/* ─── Stratégie stale-while-revalidate : retourne cache + refresh en BG ──── */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((resp) => {
    if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => null);
  return cached || networkPromise || new Response('Offline', { status: 503 });
}
