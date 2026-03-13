package main

import (
	"fmt"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type FileEntry struct {
	Name    string
	IsDir   bool
	Size    int64
	ModTime time.Time
	Ext     string
}

type DirListing struct {
	Path        string
	AbsPath     string
	Breadcrumbs []Breadcrumb
	Dirs        []FileEntry
	Files       []FileEntry
}

type Breadcrumb struct {
	Name string
	Href string
}

func NewFileExplorer(filesDir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Strip /files/ prefix to get relative path
		relPath := strings.TrimPrefix(r.URL.Path, "/files/")
		relPath = strings.TrimSuffix(relPath, "/")

		// Resolve to absolute and validate
		absPath := filepath.Join(filesDir, relPath)
		absPath, err := filepath.Abs(absPath)
		if err != nil || !strings.HasPrefix(absPath, filesDir) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		info, err := os.Stat(absPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		// If it's a file, serve it directly
		if !info.IsDir() {
			http.ServeFile(w, r, absPath)
			return
		}

		// Read directory entries
		entries, err := os.ReadDir(absPath)
		if err != nil {
			http.Error(w, "Cannot read directory", http.StatusInternalServerError)
			return
		}

		var dirs, files []FileEntry
		for _, e := range entries {
			// Skip hidden files
			if strings.HasPrefix(e.Name(), ".") {
				continue
			}
			fi, err := e.Info()
			if err != nil {
				continue
			}
			entry := FileEntry{
				Name:    e.Name(),
				IsDir:   e.IsDir(),
				Size:    fi.Size(),
				ModTime: fi.ModTime(),
				Ext:     strings.ToLower(filepath.Ext(e.Name())),
			}
			if e.IsDir() {
				dirs = append(dirs, entry)
			} else {
				files = append(files, entry)
			}
		}

		sort.Slice(dirs, func(i, j int) bool { return dirs[i].Name < dirs[j].Name })
		sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })

		// Build breadcrumbs
		breadcrumbs := []Breadcrumb{{Name: "Files", Href: "/files/"}}
		if relPath != "" {
			parts := strings.Split(relPath, "/")
			for i, p := range parts {
				href := "/files/" + strings.Join(parts[:i+1], "/") + "/"
				breadcrumbs = append(breadcrumbs, Breadcrumb{Name: p, Href: href})
			}
		}

		listing := DirListing{
			Path:        "/" + relPath,
			AbsPath:     absPath,
			Breadcrumbs: breadcrumbs,
			Files:       files,
			Dirs:        dirs,
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := dirTemplate.Execute(w, listing); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
}

func formatSize(size int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
	)
	switch {
	case size >= GB:
		return fmt.Sprintf("%.1f GB", float64(size)/float64(GB))
	case size >= MB:
		return fmt.Sprintf("%.1f MB", float64(size)/float64(MB))
	case size >= KB:
		return fmt.Sprintf("%.1f KB", float64(size)/float64(KB))
	default:
		return fmt.Sprintf("%d B", size)
	}
}

func formatTime(t time.Time) string {
	return t.Format("2006-01-02 15:04")
}

func fileIcon(ext string) string {
	switch ext {
	case ".html", ".htm":
		return "html"
	case ".css":
		return "css"
	case ".js", ".ts", ".jsx", ".tsx":
		return "code"
	case ".json", ".xml", ".yaml", ".yml", ".toml":
		return "config"
	case ".md", ".txt", ".log":
		return "text"
	case ".go", ".py", ".rs", ".java", ".c", ".cpp", ".sh":
		return "code"
	case ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico":
		return "image"
	case ".pdf":
		return "pdf"
	case ".zip", ".tar", ".gz", ".rar", ".7z":
		return "archive"
	case ".mp4", ".mov", ".avi", ".webm":
		return "video"
	case ".mp3", ".wav", ".ogg", ".flac":
		return "audio"
	default:
		return "file"
	}
}

func joinPath(dir, name string) string {
	return filepath.Join(dir, name)
}

var funcMap = template.FuncMap{
	"formatSize": formatSize,
	"formatTime": formatTime,
	"fileIcon":   fileIcon,
	"joinPath":   joinPath,
}

var dirTemplate = template.Must(template.New("dir").Funcs(funcMap).Parse(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Files{{.Path}}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface-hover: #222633;
  --border: #2a2e3d;
  --text: #e4e6ed;
  --text-dim: #8b8fa3;
  --accent: #6c9cfc;
  --accent-dim: rgba(108,156,252,0.1);
  --folder: #f0c55b;
  --radius: 10px;
  --green: #34d399;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  padding: 0;
}

.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px;
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  margin-bottom: 20px;
  font-size: 14px;
  flex-wrap: wrap;
}
.breadcrumb a {
  color: var(--accent);
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s;
}
.breadcrumb a:hover {
  background: var(--accent-dim);
}
.breadcrumb .sep {
  color: var(--text-dim);
  font-size: 11px;
  user-select: none;
}
.breadcrumb .current {
  color: var(--text);
  font-weight: 600;
  padding: 4px 8px;
}
.breadcrumb .copy-path-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  margin-left: 4px;
}
.breadcrumb .copy-path-btn:hover {
  color: var(--text);
  background: var(--surface);
}

/* Stats bar */
.stats {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-dim);
}
.stats span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.stats .spacer { flex: 1; }

/* Upload button */
.upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  color: var(--accent);
  border: 1px solid var(--border);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.upload-btn:hover {
  background: var(--surface-hover);
  border-color: var(--accent);
}

/* Search */
.search-wrap {
  margin-bottom: 12px;
}
.search-input {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 14px 10px 38px;
  border-radius: var(--radius);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b8fa3' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 12px center;
}
.search-input:focus {
  border-color: var(--accent);
}
.search-input::placeholder {
  color: var(--text-dim);
}

/* File list */
.file-list {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

/* Column header */
.col-header {
  display: grid;
  grid-template-columns: 40px 1fr auto auto 44px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  user-select: none;
}
.col-header .col {
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.15s;
}
.col-header .col:hover { color: var(--text); }
.col-header .col.active { color: var(--accent); }
.col-header .col .arrow { font-size: 10px; }
.col-header .col-icon { padding: 10px 0 10px 14px; }
.col-header .col-actions { padding: 10px 12px; }

.file-item {
  display: grid;
  grid-template-columns: 40px 1fr auto auto 44px;
  align-items: center;
  padding: 0;
  border-bottom: 1px solid var(--border);
  transition: background 0.12s;
}
.file-item:last-child { border-bottom: none; }
.file-item:hover { background: var(--surface-hover); }

.file-item a {
  display: contents;
  color: inherit;
  text-decoration: none;
}

.file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 0 14px 14px;
}
.file-icon svg {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.file-name {
  padding: 14px 12px;
  font-size: 14px;
  font-weight: 450;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.file-item.dir .file-name { color: var(--folder); }

.file-size {
  padding: 14px 16px;
  font-size: 13px;
  color: var(--text-dim);
  text-align: right;
  white-space: nowrap;
}

.file-date {
  padding: 14px 16px 14px 0;
  font-size: 13px;
  color: var(--text-dim);
  text-align: right;
  white-space: nowrap;
}

/* Share button */
.file-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}
.share-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: all 0.15s;
}
.share-btn:hover {
  color: var(--accent);
  background: var(--accent-dim);
}

/* No results */
.no-results {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-dim);
  font-size: 14px;
  display: none;
}

/* Empty state */
.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-dim);
}
.empty svg { margin-bottom: 12px; opacity: 0.4; }

/* Back link */
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  text-decoration: none;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  transition: all 0.15s;
}
.back-link:hover {
  color: var(--text);
  background: var(--surface);
}

/* Modal */
.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.modal-overlay.active { display: flex; }
.modal-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 28px;
  max-width: 480px;
  width: 100%;
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
}
.modal-card h3 {
  font-size: 16px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.modal-card .share-url-wrap {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.modal-card .share-url {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-family: monospace;
  outline: none;
  min-width: 0;
}
.modal-card .copy-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  font-weight: 500;
  transition: opacity 0.15s;
}
.modal-card .copy-btn:hover { opacity: 0.85; }
.modal-card .share-info {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 16px;
}
.modal-card .close-btn {
  background: var(--surface-hover);
  color: var(--text-dim);
  border: 1px solid var(--border);
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  width: 100%;
}
.modal-card .close-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(80px);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.3);
  z-index: 2000;
  opacity: 0;
  transition: all 0.3s ease;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* Responsive */
@media (max-width: 640px) {
  .container { padding: 16px 12px; }
  .col-header { grid-template-columns: 36px 1fr auto 40px; }
  .col-header .col-date { display: none; }
  .file-item { grid-template-columns: 36px 1fr auto 40px; }
  .file-date { display: none; }
  .file-name { font-size: 13px; }
  .file-size { font-size: 12px; padding-right: 12px; }
  .file-icon { padding-left: 10px; }
  .file-icon svg { width: 18px; height: 18px; }
  .upload-btn span.label { display: none; }
}
</style>
</head>
<body>
<div class="container">
  <nav class="breadcrumb">
    {{range $i, $b := .Breadcrumbs}}{{if $i}}<span class="sep">&rsaquo;</span>{{end}}{{if eq $i (len (slice $.Breadcrumbs 1))}}<span class="current">{{$b.Name}}</span>{{else}}<a href="{{$b.Href}}">{{$b.Name}}</a>{{end}}{{end}}
    <button class="copy-path-btn" onclick="copyPath()" title="Copy path">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
    </button>
  </nav>

  <div class="stats">
    <span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
      {{len .Dirs}} folders
    </span>
    <span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
      {{len .Files}} files
    </span>
    <span class="spacer"></span>
    <button class="upload-btn" onclick="uploadFiles()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span class="label">Upload</span>
    </button>
  </div>

  {{if or .Dirs .Files}}
  <div class="search-wrap">
    <input class="search-input" type="text" placeholder="Search files..." oninput="filterFiles(this.value)">
  </div>

  <div class="file-list" id="fileList">
    <div class="col-header">
      <div class="col-icon"></div>
      <div class="col active" data-sort="name" onclick="sortFiles('name')">Name <span class="arrow">&#9650;</span></div>
      <div class="col" data-sort="size" onclick="sortFiles('size')">Size <span class="arrow"></span></div>
      <div class="col col-date" data-sort="date" onclick="sortFiles('date')">Date <span class="arrow"></span></div>
      <div class="col-actions"></div>
    </div>
    {{range .Dirs}}
    <div class="file-item dir" data-name="{{.Name}}" data-size="0" data-date="{{.ModTime.Unix}}">
      <a href="{{.Name}}/">
        <div class="file-icon">
          <svg viewBox="0 0 24 24" fill="var(--folder)" stroke="none">
            <path d="M2 6a2 2 0 012-2h4.586a1 1 0 01.707.293L11 6H20a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
          </svg>
        </div>
        <div class="file-name">{{.Name}}</div>
        <div class="file-size">&mdash;</div>
        <div class="file-date">{{formatTime .ModTime}}</div>
      </a>
      <div class="file-actions"></div>
    </div>
    {{end}}
    {{range .Files}}
    <div class="file-item file" data-name="{{.Name}}" data-size="{{.Size}}" data-date="{{.ModTime.Unix}}">
      <a href="{{.Name}}" target="_blank">
        <div class="file-icon">
          {{if eq (fileIcon .Ext) "html"}}
          <svg viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13l2 2-2 2m4-4l2 2-2 2"/></svg>
          {{else if eq (fileIcon .Ext) "image"}}
          <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          {{else if eq (fileIcon .Ext) "code"}}
          <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          {{else if eq (fileIcon .Ext) "text"}}
          <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
          {{else if eq (fileIcon .Ext) "pdf"}}
          <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
          {{else if eq (fileIcon .Ext) "archive"}}
          <svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
          {{else if eq (fileIcon .Ext) "config"}}
          <svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2m2 0h4M8 17h8"/></svg>
          {{else}}
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
          {{end}}
        </div>
        <div class="file-name">{{.Name}}</div>
        <div class="file-size">{{formatSize .Size}}</div>
        <div class="file-date">{{formatTime .ModTime}}</div>
      </a>
      <div class="file-actions">
        <button class="share-btn" onclick="event.stopPropagation();shareFile('{{joinPath $.AbsPath .Name}}','{{.Name}}')" title="Share link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </button>
      </div>
    </div>
    {{end}}
    <div class="no-results" id="noResults">No results found</div>
  </div>
  {{else}}
  <div class="empty">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
    <p>This folder is empty</p>
  </div>
  {{end}}
</div>

<!-- Share Modal -->
<div class="modal-overlay" id="shareModal" onclick="if(event.target===this)closeModal()">
  <div class="modal-card">
    <h3>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      Share: <span id="shareFileName"></span>
    </h3>
    <div class="share-url-wrap">
      <input class="share-url" id="shareUrl" readonly onclick="this.select()">
      <button class="copy-btn" onclick="copyUrl()">Copy</button>
    </div>
    <div class="share-info">Expires in 10 minutes. Single-use link.</div>
    <button class="close-btn" onclick="closeModal()">Close</button>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
var absPath = {{.AbsPath}};

// --- Toast ---
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function(){ t.classList.remove('show'); }, 2000);
}

// --- Share ---
function shareFile(path, name) {
  document.getElementById('shareFileName').textContent = name;
  document.getElementById('shareUrl').value = 'Loading...';
  document.getElementById('shareModal').classList.add('active');
  fetch('/api/files/share', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({path: path})
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if(d.url) {
      document.getElementById('shareUrl').value = d.url;
    } else {
      document.getElementById('shareUrl').value = 'Error: ' + (d.error||'Unknown');
    }
  })
  .catch(function(){
    document.getElementById('shareUrl').value = 'Request failed';
  });
}

function copyUrl() {
  var url = document.getElementById('shareUrl').value;
  if(!url || url.startsWith('Loading') || url.startsWith('Error') || url.startsWith('Request')) return;
  navigator.clipboard.writeText(url).then(function(){
    showToast('Link copied!');
  });
}

function closeModal() {
  document.getElementById('shareModal').classList.remove('active');
}

// --- Search/Filter ---
function filterFiles(q) {
  q = q.toLowerCase();
  var items = document.querySelectorAll('#fileList .file-item');
  var visible = 0;
  items.forEach(function(el){
    var name = el.getAttribute('data-name').toLowerCase();
    var show = !q || name.indexOf(q) !== -1;
    el.style.display = show ? '' : 'none';
    if(show) visible++;
  });
  var nr = document.getElementById('noResults');
  if(nr) nr.style.display = (visible === 0 && q) ? 'block' : 'none';
}

// --- Sort ---
var currentSort = 'name';
var currentDir = 1; // 1=asc, -1=desc

function sortFiles(col) {
  if(currentSort === col) {
    currentDir *= -1;
  } else {
    currentSort = col;
    currentDir = 1;
  }
  // Update header UI
  document.querySelectorAll('.col-header .col').forEach(function(c){
    var isActive = c.getAttribute('data-sort') === col;
    c.classList.toggle('active', isActive);
    var arrow = c.querySelector('.arrow');
    if(arrow) arrow.innerHTML = isActive ? (currentDir === 1 ? '&#9650;' : '&#9660;') : '';
  });

  var list = document.getElementById('fileList');
  var dirs = Array.from(list.querySelectorAll('.file-item.dir'));
  var files = Array.from(list.querySelectorAll('.file-item.file'));
  var header = list.querySelector('.col-header');
  var noResults = document.getElementById('noResults');

  function cmp(a, b) {
    if(col === 'name') {
      var an = a.getAttribute('data-name').toLowerCase();
      var bn = b.getAttribute('data-name').toLowerCase();
      return an < bn ? -currentDir : an > bn ? currentDir : 0;
    } else if(col === 'size') {
      return (parseInt(a.getAttribute('data-size'))-parseInt(b.getAttribute('data-size')))*currentDir;
    } else {
      return (parseInt(a.getAttribute('data-date'))-parseInt(b.getAttribute('data-date')))*currentDir;
    }
  }

  // Only sort files, dirs stay in order at top
  dirs.sort(cmp);
  files.sort(cmp);

  // Re-append
  dirs.forEach(function(el){ list.appendChild(el); });
  files.forEach(function(el){ list.appendChild(el); });
  if(noResults) list.appendChild(noResults);
}

// --- Upload ---
function uploadFiles() {
  var input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = function() {
    if(!input.files.length) return;
    var pending = input.files.length;
    var errors = 0;
    for(var i=0; i<input.files.length; i++) {
      var fd = new FormData();
      fd.append('file', input.files[i]);
      fd.append('dir', absPath);
      fetch('/api/files/upload', { method:'POST', body: fd })
      .then(function(r){ return r.json(); })
      .then(function(d){
        pending--;
        if(!d.ok) errors++;
        if(pending===0) {
          if(errors) showToast('Upload: '+(input.files.length-errors)+' ok, '+errors+' failed');
          else showToast('Uploaded '+input.files.length+' file(s)');
          setTimeout(function(){ location.reload(); }, 500);
        }
      })
      .catch(function(){
        pending--;
        errors++;
        if(pending===0) {
          showToast('Upload failed');
          setTimeout(function(){ location.reload(); }, 500);
        }
      });
    }
  };
  input.click();
}

// --- Copy path ---
function copyPath() {
  navigator.clipboard.writeText(absPath).then(function(){
    showToast('Path copied!');
  });
}

// --- Keyboard shortcut: Escape to close modal ---
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape') closeModal();
});
</script>
</body>
</html>`))
