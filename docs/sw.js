// Cache dell'app: guscio sempre disponibile, dati presi prima dalla rete.
const VERSIONE = 'racingtv-v23';
const GUSCIO = ['./', 'index.html', 'style.css', 'app.js', 'account.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(GUSCIO)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSIONE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const font = /fonts\.(googleapis|gstatic)\.com/.test(url.host);
  if (url.origin !== location.origin && !font) return; // foto delle notizie: direttamente dalla rete
  if (font) { // i caratteri cambiano di rado: prima la cache
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(VERSIONE).then(x => x.put(e.request, c)); return res; })));
    return;
  }
  // no-cache: chiedo sempre al server se il file è cambiato, così le nuove versioni arrivano subito
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    const c = res.clone(); caches.open(VERSIONE).then(x => x.put(e.request, c)); return res;
  }).catch(() => caches.match(e.request)));
});
