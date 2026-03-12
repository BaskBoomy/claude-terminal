package main

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// ═══════════════════════════════════════════════════════════
// Files Explorer
// ═══════════════════════════════════════════════════════════

// Sensitive file patterns that should never be served
var sensitivePatterns = []string{
	".password_hash",
	".env",
	".credentials.json",
	"id_rsa",
	"id_ed25519",
	".ssh/authorized_keys",
}

// One-time download tokens (QR sharing)
var (
	downloadTokens   = map[string]downloadToken{}
	downloadTokensMu sync.Mutex
)

type downloadToken struct {
	Path      string
	ExpiresAt time.Time
}

func isSensitiveFile(path string) bool {
	base := filepath.Base(path)
	for _, p := range sensitivePatterns {
		if base == p || strings.HasSuffix(path, "/"+p) {
			return true
		}
	}
	return false
}

func (a *API) registerFileRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/files", a.auth.RequireAuth(a.filesList))
	mux.HandleFunc("GET /api/files/recent", a.auth.RequireAuth(a.filesRecent))
	mux.HandleFunc("GET /api/files/download", a.auth.RequireAuth(a.filesDownload))
	mux.HandleFunc("GET /api/files/preview", a.auth.RequireAuth(a.filesPreview))
	mux.HandleFunc("POST /api/files/zip", a.auth.RequireAuth(a.filesZipDownload))
	mux.HandleFunc("POST /api/files/upload", a.auth.RequireAuth(a.filesUpload))
	mux.HandleFunc("POST /api/files/share", a.auth.RequireAuth(a.filesShareCreate))
	mux.HandleFunc("GET /api/files/share/{token}", a.filesShareDownload) // no auth — token-based
}

// --- List directory ---
func (a *API) filesList(w http.ResponseWriter, r *http.Request) {
	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		dirPath = a.cfg.HomeDir
	}

	// Security: resolve and validate
	resolved, err := filepath.Abs(dirPath)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid path"})
		return
	}
	// Resolve symlinks
	resolved, err = filepath.EvalSymlinks(resolved)
	if err != nil {
		jsonResponse(w, 404, M{"error": "Path not found"})
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		jsonResponse(w, 404, M{"error": "Directory not found"})
		return
	}

	entries, err := os.ReadDir(resolved)
	if err != nil {
		jsonResponse(w, 500, M{"error": "Cannot read directory"})
		return
	}

	var items []M
	for _, e := range entries {
		name := e.Name()
		fullPath := filepath.Join(resolved, name)

		if isSensitiveFile(fullPath) {
			continue
		}

		fi, err := e.Info()
		if err != nil {
			continue
		}

		item := M{
			"name":    name,
			"isDir":   e.IsDir(),
			"size":    fi.Size(),
			"modTime": fi.ModTime().UnixMilli(),
			"path":    fullPath,
		}

		// File extension for icon mapping
		if !e.IsDir() {
			item["ext"] = strings.TrimPrefix(filepath.Ext(name), ".")
		}

		items = append(items, item)
	}

	if items == nil {
		items = []M{}
	}

	// Sort: directories first, then alphabetically
	sort.Slice(items, func(i, j int) bool {
		iDir := items[i]["isDir"].(bool)
		jDir := items[j]["isDir"].(bool)
		if iDir != jDir {
			return iDir
		}
		return strings.ToLower(items[i]["name"].(string)) < strings.ToLower(items[j]["name"].(string))
	})

	jsonResponse(w, 200, M{
		"path":   resolved,
		"parent": filepath.Dir(resolved),
		"items":  items,
	})
}

// --- Recent files ---
func (a *API) filesRecent(w http.ResponseWriter, r *http.Request) {
	homeDir := a.cfg.HomeDir
	var files []M

	// Walk home directory, collect recently modified files (max depth 4)
	filepath.Walk(homeDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		// Skip hidden directories and common non-useful dirs
		base := filepath.Base(path)
		if info.IsDir() {
			// Limit depth
			rel, _ := filepath.Rel(homeDir, path)
			depth := strings.Count(rel, string(filepath.Separator))
			if depth > 4 {
				return filepath.SkipDir
			}
			if base != "." && strings.HasPrefix(base, ".") {
				return filepath.SkipDir
			}
			if base == "node_modules" || base == "vendor" || base == ".git" || base == "__pycache__" || base == ".next" {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip hidden files and sensitive files
		if strings.HasPrefix(base, ".") || isSensitiveFile(path) {
			return nil
		}

		// Only files modified in the last 7 days
		if time.Since(info.ModTime()) > 7*24*time.Hour {
			return nil
		}

		files = append(files, M{
			"name":    base,
			"path":    path,
			"size":    info.Size(),
			"modTime": info.ModTime().UnixMilli(),
			"ext":     strings.TrimPrefix(filepath.Ext(base), "."),
			"dir":     filepath.Dir(path),
		})
		return nil
	})

	// Sort by modification time descending
	sort.Slice(files, func(i, j int) bool {
		return files[i]["modTime"].(int64) > files[j]["modTime"].(int64)
	})

	// Limit to 30
	if len(files) > 30 {
		files = files[:30]
	}
	if files == nil {
		files = []M{}
	}

	jsonResponse(w, 200, M{"files": files})
}

// --- Download file ---
func (a *API) filesDownload(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonResponse(w, 400, M{"error": "Missing path"})
		return
	}

	resolved, err := filepath.Abs(filePath)
	if err != nil || isSensitiveFile(resolved) {
		jsonResponse(w, 403, M{"error": "Access denied"})
		return
	}

	resolved, err = filepath.EvalSymlinks(resolved)
	if err != nil {
		jsonResponse(w, 404, M{"error": "File not found"})
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		jsonResponse(w, 404, M{"error": "File not found"})
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(resolved)))
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, resolved)
}

// --- Preview file (text/image inline) ---
func (a *API) filesPreview(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonResponse(w, 400, M{"error": "Missing path"})
		return
	}

	resolved, err := filepath.Abs(filePath)
	if err != nil || isSensitiveFile(resolved) {
		jsonResponse(w, 403, M{"error": "Access denied"})
		return
	}

	resolved, err = filepath.EvalSymlinks(resolved)
	if err != nil {
		jsonResponse(w, 404, M{"error": "File not found"})
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		jsonResponse(w, 404, M{"error": "File not found"})
		return
	}

	ext := strings.ToLower(filepath.Ext(resolved))

	// Image files — serve inline
	imageExts := map[string]string{
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
		".ico": "image/x-icon", ".bmp": "image/bmp",
	}
	if ct, ok := imageExts[ext]; ok {
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "private, max-age=60")
		http.ServeFile(w, r, resolved)
		return
	}

	// Text files — return content as JSON
	textExts := map[string]bool{
		".txt": true, ".md": true, ".json": true, ".yaml": true, ".yml": true,
		".toml": true, ".xml": true, ".html": true, ".css": true, ".js": true,
		".ts": true, ".tsx": true, ".jsx": true, ".go": true, ".py": true,
		".rs": true, ".sh": true, ".bash": true, ".zsh": true, ".fish": true,
		".env.example": true, ".gitignore": true, ".dockerignore": true,
		".sql": true, ".graphql": true, ".proto": true, ".lua": true,
		".rb": true, ".php": true, ".java": true, ".kt": true, ".swift": true,
		".c": true, ".h": true, ".cpp": true, ".hpp": true, ".prisma": true,
		".log": true, ".conf": true, ".cfg": true, ".ini": true, ".csv": true,
		".makefile": true, ".dockerfile": true,
	}

	baseLower := strings.ToLower(filepath.Base(resolved))
	isText := textExts[ext] || baseLower == "makefile" || baseLower == "dockerfile" ||
		baseLower == ".gitignore" || baseLower == ".dockerignore"

	if isText {
		// Limit to 500KB for preview
		if info.Size() > 512*1024 {
			jsonResponse(w, 200, M{
				"type":    "text",
				"content": "(파일이 너무 큽니다 — 500KB 초과)",
				"size":    info.Size(),
			})
			return
		}
		content, err := os.ReadFile(resolved)
		if err != nil {
			jsonResponse(w, 500, M{"error": "Cannot read file"})
			return
		}
		jsonResponse(w, 200, M{
			"type":    "text",
			"content": string(content),
			"size":    info.Size(),
			"ext":     strings.TrimPrefix(ext, "."),
		})
		return
	}

	// Unknown type
	jsonResponse(w, 200, M{
		"type": "binary",
		"size": info.Size(),
		"ext":  strings.TrimPrefix(ext, "."),
	})
}

// --- ZIP download (multiple files) ---
func (a *API) filesZipDownload(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}

	pathsRaw, ok := body["paths"].([]interface{})
	if !ok || len(pathsRaw) == 0 {
		jsonResponse(w, 400, M{"error": "No files specified"})
		return
	}

	var paths []string
	for _, p := range pathsRaw {
		s, ok := p.(string)
		if !ok {
			continue
		}
		resolved, err := filepath.Abs(s)
		if err != nil || isSensitiveFile(resolved) {
			continue
		}
		resolved, err = filepath.EvalSymlinks(resolved)
		if err != nil {
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil || info.IsDir() {
			continue
		}
		paths = append(paths, resolved)
	}

	if len(paths) == 0 {
		jsonResponse(w, 400, M{"error": "No valid files"})
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="files-%s.zip"`, time.Now().Format("20060102-150405")))

	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		info, _ := f.Stat()
		header, _ := zip.FileInfoHeader(info)
		header.Name = filepath.Base(p)
		header.Method = zip.Deflate

		writer, err := zw.CreateHeader(header)
		if err != nil {
			f.Close()
			continue
		}
		io.Copy(writer, f)
		f.Close()
	}
}

// --- Upload to specific directory ---
func (a *API) filesUpload(w http.ResponseWriter, r *http.Request) {
	const maxUpload = 100 * 1024 * 1024 // 100MB

	if err := r.ParseMultipartForm(maxUpload); err != nil {
		jsonResponse(w, 413, M{"error": "Upload too large"})
		return
	}

	targetDir := r.FormValue("dir")
	if targetDir == "" {
		targetDir = a.cfg.HomeDir
	}

	resolved, err := filepath.Abs(targetDir)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid directory"})
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		jsonResponse(w, 404, M{"error": "Directory not found"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		jsonResponse(w, 400, M{"error": "No file provided"})
		return
	}
	defer file.Close()

	// Sanitize filename
	filename := filepath.Base(header.Filename)
	if filename == "." || filename == ".." {
		filename = "upload"
	}

	destPath := filepath.Join(resolved, filename)

	// If file exists, add suffix
	if _, err := os.Stat(destPath); err == nil {
		ext := filepath.Ext(filename)
		base := strings.TrimSuffix(filename, ext)
		for i := 1; ; i++ {
			destPath = filepath.Join(resolved, fmt.Sprintf("%s_%d%s", base, i, ext))
			if _, err := os.Stat(destPath); os.IsNotExist(err) {
				break
			}
		}
	}

	dst, err := os.Create(destPath)
	if err != nil {
		jsonResponse(w, 500, M{"error": "Failed to create file"})
		return
	}
	defer dst.Close()

	io.Copy(dst, file)
	jsonResponse(w, 200, M{"ok": true, "path": destPath, "name": filepath.Base(destPath)})
}

// --- Share link (QR code) — create one-time token ---
func (a *API) filesShareCreate(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}

	filePath, _ := body["path"].(string)
	if filePath == "" {
		jsonResponse(w, 400, M{"error": "Missing path"})
		return
	}

	resolved, err := filepath.Abs(filePath)
	if err != nil || isSensitiveFile(resolved) {
		jsonResponse(w, 403, M{"error": "Access denied"})
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		jsonResponse(w, 404, M{"error": "File not found"})
		return
	}

	// Generate token
	tokenBytes := make([]byte, 16)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	downloadTokensMu.Lock()
	// Cleanup expired tokens
	now := time.Now()
	for k, v := range downloadTokens {
		if now.After(v.ExpiresAt) {
			delete(downloadTokens, k)
		}
	}
	downloadTokens[token] = downloadToken{
		Path:      resolved,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	downloadTokensMu.Unlock()

	// Build URL
	scheme := "http"
	if a.cfg.Domain != "" {
		scheme = "https"
	}
	host := r.Host
	url := fmt.Sprintf("%s://%s/api/files/share/%s", scheme, host, token)

	jsonResponse(w, 200, M{
		"token": token,
		"url":   url,
		"name":  filepath.Base(resolved),
		"expires": now.Add(10 * time.Minute).UnixMilli(),
	})
}

// --- Share download (no auth, token-based) ---
func (a *API) filesShareDownload(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")

	downloadTokensMu.Lock()
	dt, ok := downloadTokens[token]
	if ok {
		delete(downloadTokens, token) // one-time use
	}
	downloadTokensMu.Unlock()

	if !ok || time.Now().After(dt.ExpiresAt) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(404)
		w.Write([]byte(`<!DOCTYPE html><html><body style="background:#1A1917;color:#EAE7DF;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2>링크가 만료되었습니다</h2><p style="color:#A9A39A">이 다운로드 링크는 1회용이며 10분 후 만료됩니다.</p></div></body></html>`))
		return
	}

	info, err := os.Stat(dt.Path)
	if err != nil {
		http.Error(w, "File not found", 404)
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(dt.Path)))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	http.ServeFile(w, r, dt.Path)
}

// --- Favorites (stored in settings) ---
// Favorites are managed client-side in settings.general.fileFavorites

// --- Edit text file ---
func (a *API) registerFileEditRoute(mux *http.ServeMux) {
	mux.HandleFunc("PUT /api/files/edit", a.auth.RequireAuth(a.filesEdit))
}

func (a *API) filesEdit(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}

	filePath, _ := body["path"].(string)
	content, _ := body["content"].(string)

	if filePath == "" {
		jsonResponse(w, 400, M{"error": "Missing path"})
		return
	}

	resolved, err := filepath.Abs(filePath)
	if err != nil || isSensitiveFile(resolved) {
		jsonResponse(w, 403, M{"error": "Access denied"})
		return
	}

	// Only allow editing existing text files
	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		jsonResponse(w, 404, M{"error": "File not found"})
		return
	}

	// Write atomically
	tmpFile := resolved + ".tmp"
	if err := os.WriteFile(tmpFile, []byte(content), 0644); err != nil {
		jsonResponse(w, 500, M{"error": "Failed to write file"})
		return
	}
	if err := os.Rename(tmpFile, resolved); err != nil {
		os.Remove(tmpFile)
		jsonResponse(w, 500, M{"error": "Failed to save file"})
		return
	}

	jsonResponse(w, 200, M{"ok": true})
}

func init() {
	// Register JSON encoder for int64
	_ = json.Marshal
}
