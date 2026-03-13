package main

import (
	"crypto/tls"
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
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

	// Initialize push manager + file watcher
	push := NewPushManager(cfg.DataDir)
	push.WatchNotifyDir(cfg.NotifyDir)

	// Build API router
	mux := http.NewServeMux()
	api := &API{cfg: cfg, auth: auth, brain: brain, push: push}
	api.RegisterRoutes(mux)

	// ttyd reverse proxy (WebSocket-aware)
	ttydProxy := newTtydProxy(cfg)

	// Static files from embedded FS
	publicSub, _ := fs.Sub(publicFS, "public")

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
			token := getSessionToken(r, cfg.CookieName)
			if !auth.ValidateSession(token) {
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
			token := getSessionToken(r, cfg.CookieName)
			if !auth.ValidateSession(token) {
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
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		servePath := strings.TrimPrefix(path, "/")
		if servePath == "" {
			servePath = "index.html"
		}

		// Auth check for non-public paths
		if !isPublicPath(path) {
			token := getSessionToken(r, cfg.CookieName)
			if !auth.ValidateSession(token) {
				http.Redirect(w, r, "/login.html", http.StatusFound)
				return
			}
		}

		// Try disk first (allows overriding embedded files)
		diskPath := filepath.Join(cfg.PublicDir, servePath)
		if info, err := os.Stat(diskPath); err == nil && !info.IsDir() {
			http.ServeFile(w, r, diskPath)
			return
		}

		// Try embedded FS
		if f, err := publicSub.Open(servePath); err == nil {
			f.Close()
			http.FileServer(http.FS(publicSub)).ServeHTTP(w, r)
			return
		}

		// SPA fallback
		if !strings.Contains(servePath, ".") {
			diskIndex := filepath.Join(cfg.PublicDir, "index.html")
			if _, err := os.Stat(diskIndex); err == nil {
				http.ServeFile(w, r, diskIndex)
				return
			}
			http.ServeFileFS(w, r, publicSub, "index.html")
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

// newTtydProxy creates a reverse proxy for ttyd with WebSocket support.
func newTtydProxy(cfg *Config) http.Handler {
	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", cfg.TtydPort))

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
		},
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
