self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);
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
    }
});
