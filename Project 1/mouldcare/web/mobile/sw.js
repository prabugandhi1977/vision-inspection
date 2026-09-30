const CACHE='mouldcare-field-v2',SHELL=['/mobile/','/mobile/index.html','/mobile/app.js','/mobile/style.css','/mobile/icon-192.png','/mobile/icon-512.png','/mobile/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin===location.origin&&url.pathname.startsWith('/mobile/')&&event.request.method==='GET')event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));});
