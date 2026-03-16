package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/css"
	"github.com/tdewolff/minify/v2/html"
	"github.com/tdewolff/minify/v2/js"
	mjson "github.com/tdewolff/minify/v2/json"
)

// CachedAsset holds a pre-processed asset in memory.
type CachedAsset struct {
	Raw      []byte
	Gzipped  []byte
	ETag     string
	MimeType string
}

// AssetServer minifies and gzip-compresses assets at startup, then serves from memory.
type AssetServer struct {
	mu       sync.RWMutex
	cache    map[string]*CachedAsset
	mini     *minify.M
	diskDir  string // optional disk override directory
}

// NewAssetServer builds the cache from the embedded FS (and optional disk overrides).
func NewAssetServer(embedFS fs.FS, diskDir string) *AssetServer {
	m := minify.New()
	m.AddFunc("text/css", css.Minify)
	m.AddFunc("text/html", html.Minify)
	m.AddFunc("application/javascript", js.Minify)
	m.AddFunc("application/json", mjson.Minify)

	as := &AssetServer{
		cache:   make(map[string]*CachedAsset),
		mini:    m,
		diskDir: diskDir,
	}

	start := time.Now()
	var totalRaw, totalGz int

	// Walk embedded FS
	fs.WalkDir(embedFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		f, err := embedFS.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()

		data, err := io.ReadAll(f)
		if err != nil {
			return nil
		}

		// Check disk override
		if diskDir != "" {
			diskPath := filepath.Join(diskDir, path)
			if diskData, err := os.ReadFile(diskPath); err == nil {
				data = diskData
			}
		}

		asset := as.processAsset(path, data)
		as.cache[path] = asset
		totalRaw += len(asset.Raw)
		totalGz += len(asset.Gzipped)
		return nil
	})

	// Walk disk directory for files NOT in embedded FS (e.g. newer assets)
	if diskDir != "" {
		filepath.WalkDir(diskDir, func(diskPath string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(diskDir, diskPath)
			if err != nil {
				return nil
			}
			rel = filepath.ToSlash(rel)
			if _, exists := as.cache[rel]; exists {
				return nil // already loaded from embed (possibly overridden)
			}
			data, err := os.ReadFile(diskPath)
			if err != nil {
				return nil
			}
			asset := as.processAsset(rel, data)
			as.cache[rel] = asset
			totalRaw += len(asset.Raw)
			totalGz += len(asset.Gzipped)
			return nil
		})
	}

	ratio := float64(0)
	if totalRaw > 0 {
		ratio = (1 - float64(totalGz)/float64(totalRaw)) * 100
	}
	log.Printf("  Assets: %d files, %s → %s (%.0f%% smaller) in %dms",
		len(as.cache),
		formatBytes(totalRaw),
		formatBytes(totalGz),
		ratio,
		time.Since(start).Milliseconds(),
	)

	return as
}

// processAsset minifies (if applicable) and gzip-compresses a file.
func (as *AssetServer) processAsset(path string, data []byte) *CachedAsset {
	mimeType := detectMime(path)

	// Minify if supported
	minified, err := as.mini.Bytes(mimeType, data)
	if err != nil {
		minified = data // fallback to original
	}

	// Gzip compress
	var gzBuf bytes.Buffer
	gz, _ := gzip.NewWriterLevel(&gzBuf, gzip.BestCompression)
	gz.Write(minified)
	gz.Close()

	// Content hash for ETag
	hash := sha256.Sum256(minified)
	etag := fmt.Sprintf(`"%x"`, hash[:8])

	return &CachedAsset{
		Raw:      minified,
		Gzipped:  gzBuf.Bytes(),
		ETag:     etag,
		MimeType: mimeType,
	}
}

// Serve handles an HTTP request for a static asset.
func (as *AssetServer) Serve(w http.ResponseWriter, r *http.Request, path string, cachePolicy string) bool {
	as.mu.RLock()
	asset, ok := as.cache[path]
	as.mu.RUnlock()
	if !ok {
		return false
	}

	// ETag-based conditional request
	if r.Header.Get("If-None-Match") == asset.ETag {
		w.WriteHeader(http.StatusNotModified)
		return true
	}

	w.Header().Set("ETag", asset.ETag)
	w.Header().Set("Vary", "Accept-Encoding")

	if cachePolicy != "" {
		w.Header().Set("Cache-Control", cachePolicy)
	}

	if asset.MimeType != "" {
		w.Header().Set("Content-Type", asset.MimeType)
	}

	// Serve gzipped if client supports it and it's actually smaller
	if len(asset.Gzipped) < len(asset.Raw) && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(asset.Gzipped)))
		w.Write(asset.Gzipped)
	} else {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(asset.Raw)))
		w.Write(asset.Raw)
	}
	return true
}

// Has checks if an asset exists in the cache.
func (as *AssetServer) Has(path string) bool {
	as.mu.RLock()
	_, ok := as.cache[path]
	as.mu.RUnlock()
	return ok
}

// detectMime returns the MIME type for a file path.
func detectMime(path string) string {
	ext := filepath.Ext(path)
	switch ext {
	case ".js", ".mjs":
		return "application/javascript"
	case ".css":
		return "text/css"
	case ".html":
		return "text/html; charset=utf-8"
	case ".json":
		return "application/json"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".ico":
		return "image/x-icon"
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	default:
		if ct := mime.TypeByExtension(ext); ct != "" {
			return ct
		}
		return "application/octet-stream"
	}
}

// formatBytes formats byte count as human-readable string.
func formatBytes(b int) string {
	if b < 1024 {
		return fmt.Sprintf("%dB", b)
	}
	kb := float64(b) / 1024
	if kb < 1024 {
		return fmt.Sprintf("%.1fKB", kb)
	}
	return fmt.Sprintf("%.1fMB", kb/1024)
}
