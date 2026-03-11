// v3 — network-first for all app assets
var CACHE_VERSION = 'v4';

self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(names.map(function(name) { return caches.delete(name); }));
        }).then(function() { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(names.map(function(name) { return caches.delete(name); }));
        }).then(function() { return self.clients.claim(); })
    );
});

// ─── Push Notification ───────────────────────────────────────────────────────

self.addEventListener('push', function(e) {
    var data = {};
    try { data = e.data.json(); } catch(err) {
        data = { title: 'Claude Terminal', message: e.data ? e.data.text() : '' };
    }
    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
            // Skip push notification if any app window is visible (foreground)
            var hasFocused = clients.some(function(c) { return c.visibilityState === 'visible'; });
            if (hasFocused) return;
            return self.registration.showNotification(data.title || 'Claude Terminal', {
                body: data.message || '',
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: 'claude-terminal',
                renotify: true,
                vibrate: [200, 100, 200]
            });
        })
    );
});

self.addEventListener('notificationclick', function(e) {
    e.notification.close();
    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
            for (var i = 0; i < clients.length; i++) {
                if (clients[i].url.indexOf(self.location.origin) !== -1) {
                    return clients[i].focus();
                }
            }
            return self.clients.openWindow('/');
        })
    );
});

self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // ttyd: patch WebSocket interception
    if (url.pathname === '/ttyd/' && event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).then(function(response) {
                return response.text().then(function(html) {
                    var patch = '<script>' +
                        'window._ws=null;' +
                        'var _WS=WebSocket;' +
                        'window.WebSocket=function(u,p){' +
                            'var w=p?new _WS(u,p):new _WS(u);' +
                            'window._ws=w;' +
                            'return w;' +
                        '};' +
                        'window.WebSocket.prototype=_WS.prototype;' +
                        'window.WebSocket.CONNECTING=0;' +
                        'window.WebSocket.OPEN=1;' +
                        'window.WebSocket.CLOSING=2;' +
                        'window.WebSocket.CLOSED=3;' +
                    '<\/script>';
                    html = html.replace('<head>', '<head>' + patch);
                    return new Response(html, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                });
            })
        );
        return;
    }

    // All same-origin JS, CSS, and HTML: network-first, bypass cache
    if (url.origin === self.location.origin) {
        var ext = url.pathname.split('.').pop();
        if (ext === 'js' || ext === 'css' || ext === 'html' || url.pathname === '/' || event.request.mode === 'navigate') {
            event.respondWith(
                fetch(event.request, { cache: 'no-store' }).catch(function() {
                    return caches.match(event.request);
                })
            );
            return;
        }
    }
});
