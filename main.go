package main

import (
	"bytes"
	"compress/gzip"
	"crypto/tls"
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"time"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/acme/autocert"
)

//go:embed public/*
var publicFS embed.FS

func main() {
	// CLI flags
	port := flag.Int("port", 0, "Server port (default: 7680, or PORT env)")
	password := flag.String("password", "", "Login password (or PASSWORD env)")
	domain := flag.String("domain", "", "Domain for auto HTTPS (or DOMAIN env)")
	flag.Parse()

	// Load config
	cfg := LoadConfig(*port, *password)
	if *domain != "" {
		cfg.Domain = *domain
	}

	// Ensure data directories
	os.MkdirAll(cfg.DataDir, 0755)
	os.MkdirAll(cfg.NotesDir, 0755)
	os.MkdirAll(cfg.UploadDir, 0755)
	os.MkdirAll(cfg.FilesDir, 0755)

	// Initialize auth
	auth := NewAuth(cfg)

	// Initialize brain scanner
	brain := NewBrain(cfg)

	// Initialize TOTP (2FA)
	totp := NewTOTP(cfg.DataDir)

	// Initialize push manager + file watcher
	push := NewPushManager(cfg.DataDir, cfg.SettingsFile)
	push.WatchNotifyDir(cfg.NotifyDir)

	// Build API router
	mux := http.NewServeMux()
	api := &API{cfg: cfg, auth: auth, brain: brain, push: push, totp: totp}
	api.RegisterRoutes(mux)

	// ttyd reverse proxy (WebSocket-aware)
	ttydProxy := newTtydProxy(cfg)

	// Static files from embedded FS
	publicSub, _ := fs.Sub(publicFS, "public")

	// Asset server: minifies + gzip-compresses at startup, serves from memory
	assets := NewAssetServer(publicSub, cfg.PublicDir)

	// Custom file explorer with beautiful UI
	filesServer := NewFileExplorer(cfg.FilesDir)

	// Main handler
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Security headers
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws:; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self'")
		if cfg.Domain != "" {
			w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}

		path := r.URL.Path

		// Static files: /files/* (auth required, directory listing enabled)
		if path == "/files" || path == "/files/" || strings.HasPrefix(path, "/files/") {
			if !ensureAuth(w, r, cfg, auth) {
				http.Redirect(w, r, "/login.html", http.StatusFound)
				return
			}
			if path == "/files" {
				http.Redirect(w, r, "/files/", http.StatusMovedPermanently)
				return
			}
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			filesServer.ServeHTTP(w, r)
			return
		}

		// ttyd proxy: /ttyd/*
		if path == "/ttyd" || path == "/ttyd/" || strings.HasPrefix(path, "/ttyd/") {
			if !ensureAuth(w, r, cfg, auth) {
				http.Error(w, "Forbidden", 403)
				return
			}
			ttydProxy.ServeHTTP(w, r)
			return
		}

		// API and upload
		if strings.HasPrefix(path, "/api/") || path == "/upload" {
			mux.ServeHTTP(w, r)
			return
		}

		// Static files
		servePath := strings.TrimPrefix(path, "/")
		if servePath == "" {
			servePath = "index.html"
		}

		// Auth check for non-public paths
		if !isPublicPath(path) {
			if !ensureAuth(w, r, cfg, auth) {
				http.Redirect(w, r, "/login.html", http.StatusFound)
				return
			}
		}

		// Cache policy: HTML = revalidate (ETag), assets = long cache
		cachePolicy := "no-cache" // HTML: always revalidate via ETag
		if strings.HasPrefix(servePath, "js/") || strings.HasPrefix(servePath, "css/") {
			cachePolicy = "public, max-age=604800, immutable" // 7 days (busted by ?v=N)
		} else if strings.HasSuffix(servePath, ".png") || strings.HasSuffix(servePath, ".json") {
			cachePolicy = "public, max-age=86400" // 1 day
		}

		// Serve from asset cache (minified + gzipped)
		if assets.Serve(w, r, servePath, cachePolicy) {
			return
		}

		// SPA fallback for extensionless paths
		if !strings.Contains(servePath, ".") {
			assets.Serve(w, r, "index.html", "no-cache")
			return
		}

		http.NotFound(w, r)
	})

	// Start server
	if cfg.Domain != "" {
		// HTTPS with auto Let's Encrypt
		startHTTPS(cfg, handler)
	} else {
		// HTTP only
		addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
		log.Printf("Claude Terminal running on http://%s", addr)
		logStartupInfo(cfg)
		if err := http.ListenAndServe(addr, handler); err != nil {
			log.Fatal(err)
		}
	}
}

// Script injected into ttyd's HTML to:
//  1. auto-copy xterm.js selection to the clipboard (writable/blur-safe)
//  2. drop ttyd's built-in "Are you sure you want to leave?" beforeunload
const ttydInjectScript = `<script>(function(){
function wireTerm(t){
  if(!t||t.__copyHooked)return;
  t.__copyHooked=true;
  t.onSelectionChange&&t.onSelectionChange(function(){
    try{
      var s=t.getSelection&&t.getSelection();
      if(s&&navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(s).catch(function(){});
      }
    }catch(e){}
  });
}
var tries=0,iv=setInterval(function(){
  if(window.term){wireTerm(window.term);clearInterval(iv);}
  else if(++tries>100)clearInterval(iv);
},100);
window.addEventListener('beforeunload',function(e){
  e.stopImmediatePropagation&&e.stopImmediatePropagation();
  delete e.returnValue;
},true);
try{window.onbeforeunload=null;}catch(e){}
})();</script>`

// ensureAuth validates the session; if missing/invalid it checks the
// auto-login IP whitelist and, on match, mints a session cookie on the fly.
// Returns true when the caller may proceed as an authenticated user.
func ensureAuth(w http.ResponseWriter, r *http.Request, cfg *Config, auth *Auth) bool {
	token := getSessionToken(r, cfg.CookieName)
	if auth.ValidateSession(token) {
		return true
	}
	ip := getClientIP(r, cfg.TrustProxy)
	if !auth.IsAutoLoginIP(ip) {
		return false
	}
	newToken := auth.CreateSession(ip)
	setSessionCookie(w, cfg, newToken)
	return true
}

// newTtydProxy creates a reverse proxy for ttyd with WebSocket support.
// For text/html responses it injects ttydInjectScript before </body> so
// terminal selection auto-copies and ttyd's leave-alert is disarmed.
func newTtydProxy(cfg *Config) http.Handler {
	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", cfg.TtydPort))

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
			// Disable gzip so ModifyResponse can rewrite the body without decompressing.
			req.Header.Set("Accept-Encoding", "identity")
		},
		ModifyResponse: injectTtydScript,
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// WebSocket upgrade: tunnel raw TCP
		if isWebSocketUpgrade(r) {
			tunnelWebSocket(w, r, target.Host)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

func injectTtydScript(resp *http.Response) error {
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(strings.ToLower(ct), "text/html") {
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return err
	}

	// Handle gzip just in case the backend ignored our Accept-Encoding.
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gr, err := gzip.NewReader(bytes.NewReader(body))
		if err == nil {
			if decoded, err2 := io.ReadAll(gr); err2 == nil {
				body = decoded
				resp.Header.Del("Content-Encoding")
			}
			gr.Close()
		}
	}

	inject := []byte(ttydInjectScript)
	if idx := bytes.LastIndex(body, []byte("</body>")); idx >= 0 {
		body = append(body[:idx], append(inject, body[idx:]...)...)
	} else {
		body = append(body, inject...)
	}

	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	return nil
}

func isWebSocketUpgrade(r *http.Request) bool {
	for _, v := range r.Header.Values("Connection") {
		if strings.Contains(strings.ToLower(v), "upgrade") {
			for _, u := range r.Header.Values("Upgrade") {
				if strings.EqualFold(u, "websocket") {
					return true
				}
			}
		}
	}
	return false
}

func tunnelWebSocket(w http.ResponseWriter, r *http.Request, targetHost string) {
	// Connect to ttyd backend
	backConn, err := net.Dial("tcp", targetHost)
	if err != nil {
		http.Error(w, "Backend unavailable", http.StatusBadGateway)
		return
	}
	defer backConn.Close()

	// Hijack the client connection
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "WebSocket not supported", http.StatusInternalServerError)
		return
	}
	clientConn, clientBuf, err := hj.Hijack()
	if err != nil {
		http.Error(w, "Connection error", http.StatusInternalServerError)
		return
	}
	defer clientConn.Close()

	// Set idle timeout to prevent goroutine exhaustion
	idleTimeout := 30 * time.Minute
	clientConn.SetDeadline(time.Now().Add(idleTimeout))
	backConn.SetDeadline(time.Now().Add(idleTimeout))

	// Forward the original HTTP request to backend
	if err := r.Write(backConn); err != nil {
		return
	}

	// Flush any buffered data from the client
	if clientBuf.Reader.Buffered() > 0 {
		buffered := make([]byte, clientBuf.Reader.Buffered())
		clientBuf.Read(buffered)
		backConn.Write(buffered)
	}

	// Bidirectional copy
	done := make(chan struct{}, 2)
	go func() { io.Copy(clientConn, backConn); done <- struct{}{} }()
	go func() { io.Copy(backConn, clientConn); done <- struct{}{} }()
	<-done
}

// startHTTPS starts the server with automatic Let's Encrypt certificates.
func startHTTPS(cfg *Config, handler http.Handler) {
	certDir := filepath.Join(cfg.DataDir, "certs")
	os.MkdirAll(certDir, 0700)

	manager := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(cfg.Domain),
		Cache:      autocert.DirCache(certDir),
	}

	// HTTP server for ACME challenges + redirect to HTTPS
	go func() {
		httpAddr := fmt.Sprintf("%s:80", cfg.Host)
		log.Printf("HTTP redirect on %s", httpAddr)
		http.ListenAndServe(httpAddr, manager.HTTPHandler(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				target := "https://" + cfg.Domain + r.URL.RequestURI()
				http.Redirect(w, r, target, http.StatusMovedPermanently)
			}),
		))
	}()

	// HTTPS server
	tlsConfig := &tls.Config{
		GetCertificate: manager.GetCertificate,
		MinVersion:     tls.VersionTLS12,
	}

	server := &http.Server{
		Addr:      fmt.Sprintf("%s:443", cfg.Host),
		Handler:   handler,
		TLSConfig: tlsConfig,
	}

	log.Printf("Claude Terminal running on https://%s", cfg.Domain)
	logStartupInfo(cfg)
	if err := server.ListenAndServeTLS("", ""); err != nil {
		log.Fatal(err)
	}
}

func logStartupInfo(cfg *Config) {
	log.Printf("  Data dir: %s", cfg.DataDir)
	log.Printf("  ttyd port: %d", cfg.TtydPort)
	if cfg.TmuxSocket != "" {
		log.Printf("  tmux socket: %s", cfg.TmuxSocket)
	}
	if n := len(cfg.AutoLoginNets) + len(cfg.AutoLoginIPs); n > 0 {
		log.Printf("  auto-login IPs: %d entries configured", n)
	}
}

func isPublicPath(path string) bool {
	publics := []string{
		"/login.html", "/manifest.json", "/icon-192.png", "/sw.js",
	}
	for _, p := range publics {
		if path == p {
			return true
		}
	}
	return strings.HasPrefix(path, "/css/") || strings.HasPrefix(path, "/js/")
}

func getSessionToken(r *http.Request, cookieName string) string {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}
	return c.Value
}
