/**
 * Service Worker Lucens IA â€” mode offline-first pour HACCP terrain.
 *
 * Objectif : l'app fonctionne hors-ligne pour TOUT sauf l'analyse Claude
 * (qui exige Anthropic). Les analyses lancÃ©es offline vont en queue locale
 * (gÃ©rÃ© par le code app, pas le SW) et partent au retour de connexion.
 *
 * StratÃ©gies de cache :
 *   - App shell (HTML, CSS, JS principal) : cache-first avec fallback rÃ©seau
 *   - Assets statiques (fonts, libs CDN) : cache-first stale-while-revalidate
 *   - /api/* : NEVER cached (toujours rÃ©seau, Ã©chec gÃ©rÃ© par l'app)
 *
 * Versionning : bump CACHE_VERSION Ã  chaque dÃ©ploiement majeur pour purge propre.
 */

const CACHE_VERSION = 'lucens-v273-2026-06-10';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

/* URLs critiques Ã  cacher au moment de l'installation.
   Si une de ces ressources Ã©choue, l'install du SW Ã©choue (volontairement
   conservateur : on veut Ãªtre sÃ»r que l'app marche offline aprÃ¨s install). */
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/privacy.html',
];

/* URLs externes (CDN) qui sont chargÃ©es par index.html.
   On les cache aussi pour offline. Liste maintenue manuellement, Ã  mettre
   Ã  jour si les <script src> changent. */
const EXTERNAL_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
];

/* â”€â”€â”€ INSTALL â€” pre-cache de l'app shell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      console.log('[SW] Pre-caching app shell');
      /* App shell : on bloque si Ã©chec (critique) */
      return cache.addAll(APP_SHELL_URLS).then(() => {
        /* External libs : best-effort (pas de blocage si CDN down) */
        return Promise.allSettled(
          EXTERNAL_LIBS.map((url) =>
            fetch(url, { mode: 'cors', credentials: 'omit' })
              .then((resp) => resp.ok ? cache.put(url, resp) : null)
              .catch((e) => console.warn('[SW] Cache CDN Ã©chouÃ©:', url, e?.message))
          )
        );
      });
    }).then(() => self.skipWaiting())
  );
});

/* â”€â”€â”€ ACTIVATE â€” purge des anciens caches versionnÃ©s â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
     /* V38 fix F-06 â€” Le force-reload brutal de V30 (c.navigate(c.url)) faisait
        perdre la saisie en cours sur le terrain HACCP. On notifie maintenant
        les clients via postMessage et c'est le code app qui dÃ©cide d'afficher
        une banniÃ¨re "Mise Ã  jour disponible Â· Recharger" non-bloquante. */
     .then(() => self.clients.matchAll({ type: 'window' }))
     .then((clients) => clients.forEach((c) => {
       try {
         c.postMessage({ type: 'SW_UPDATE_AVAILABLE', version: CACHE_VERSION });
       } catch (e) {}
     }))
  );
});

/* â”€â”€â”€ FETCH â€” stratÃ©gies par type de requÃªte â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  /* Bypass : POST, PUT, DELETE, etc. â€” pas de cache pour mutations */
  if (req.method !== 'GET') return;

  /* /api/* â€” JAMAIS cacher. Toujours rÃ©seau. Ã‰chec gÃ©rÃ© cÃ´tÃ© app. */
  if (url.pathname.startsWith('/api/')) {
    /* On laisse passer la requÃªte rÃ©seau telle quelle. Si elle Ã©choue,
       l'app reÃ§oit l'erreur fetch et peut basculer en mode queue offline. */
    return;
  }

  /* V18.1 â€” index.html en NETWORK-FIRST pour Ã©viter qu'un cache navigateur
     pÃ©rimÃ© serve une version mojibake/buggy aprÃ¨s un dÃ©ploiement.
     Le HTML est petit (~1 Mo), le coÃ»t rÃ©seau est nÃ©gligeable et la fraÃ®cheur
     prÃ©vaut sur la perf brute. Le cache reste utilisÃ© en fallback offline. */
  const isHtml = req.headers.get('accept')?.includes('text/html')
              || url.pathname === '/' || url.pathname.endsWith('.html');
  if (url.origin === self.location.origin && isHtml) {
    event.respondWith(networkFirst(req, APP_SHELL_CACHE));
    return;
  }

  /* Other same-origin (CSS, JS, images, manifest) â€” cache-first */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, APP_SHELL_CACHE));
    return;
  }

  /* External (CDN libs, fonts) â€” cache-first stale-while-revalidate */
  if (EXTERNAL_LIBS.includes(req.url) ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com' ||
      url.hostname === 'cdnjs.cloudflare.com' ||
      url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  /* Autres requÃªtes : rÃ©seau direct, pas de cache */
});

/* â”€â”€â”€ V18.1 â€” StratÃ©gie network-first : essaye rÃ©seau, fallback cache â”€â”€â”€â”€
   Pour le HTML : on veut TOUJOURS la derniÃ¨re version dÃ©ployÃ©e. Si offline
   ou rÃ©seau lent (timeout 3s), on retombe sur le cache. */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const controller = new AbortController();
    /* V156 â€” Timeout rÃ©seau portÃ© Ã  6s (Ã©tait 3s). Sur connexion mobile lente,
       3s dÃ©clenchait trop tÃ´t le repli sur le cache â†’ l'utilisateur restait sur
       l'ANCIENNE version en cache. Hors-ligne rÃ©el : le fetch Ã©choue tout de
       suite (pas via ce timeout), donc le repli reste instantanÃ©. */
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

/* â”€â”€â”€ StratÃ©gie cache-first : essaye cache, fallback rÃ©seau â”€â”€â”€â”€â”€â”€â”€ */
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
    /* Offline + pas en cache â†’ renvoie une rÃ©ponse "offline" */
    if (req.headers.get('accept')?.includes('text/html')) {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline et ressource non disponible en cache', {
      status: 503, statusText: 'Service Unavailable'
    });
  }
}

/* â”€â”€â”€ StratÃ©gie stale-while-revalidate : retourne cache + refresh en BG â”€â”€â”€â”€ */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((resp) => {
    if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => null);
  return cached || networkPromise || new Response('Offline', { status: 503 });
}
