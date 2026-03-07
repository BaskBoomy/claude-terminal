package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed public/*
var publicFS embed.FS

func main() {
	// CLI flags
	port := flag.Int("port", 0, "Server port (default: 7680, or PORT env)")
	password := flag.String("password", "", "Login password (or PASSWORD env)")
	flag.Parse()

	// Load config
	cfg := LoadConfig(*port, *password)

	// Ensure data directories
	os.MkdirAll(cfg.DataDir, 0755)
	os.MkdirAll(cfg.NotesDir, 0755)
	os.MkdirAll(cfg.UploadDir, 0755)

	// Initialize auth
	auth := NewAuth(cfg)

	// Initialize brain scanner
	brain := NewBrain(cfg)

	// Build router
	mux := http.NewServeMux()

	// API routes
	api := &API{cfg: cfg, auth: auth, brain: brain}
	api.RegisterRoutes(mux)

	// Static files from embedded FS (fallback)
	publicSub, _ := fs.Sub(publicFS, "public")

	// Main handler: API first, then static files
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// API and upload routes are handled by mux
		if strings.HasPrefix(path, "/api/") || path == "/upload" {
			mux.ServeHTTP(w, r)
			return
		}

		// Static files: try embedded FS first, then disk
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		servePath := strings.TrimPrefix(path, "/")
		if servePath == "" {
			servePath = "index.html"
		}

		// Check if file requires auth (not public assets)
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

		// SPA fallback: serve index.html
		if !strings.Contains(servePath, ".") {
			diskIndex := filepath.Join(cfg.PublicDir, "index.html")
			if _, err := os.Stat(diskIndex); err == nil {
				http.ServeFile(w, r, diskIndex)
				return
			}
			// Embedded index.html
			http.ServeFileFS(w, r, publicSub, "index.html")
			return
		}

		http.NotFound(w, r)
	})

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	log.Printf("Claude Terminal running on http://%s", addr)
	log.Printf("  Data dir: %s", cfg.DataDir)
	if cfg.TmuxSocket != "" {
		log.Printf("  tmux socket: %s", cfg.TmuxSocket)
	}

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
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
