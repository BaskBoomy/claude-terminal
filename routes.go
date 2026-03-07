package main

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// M is a shorthand for map[string]any
type M = map[string]any

type API struct {
	cfg   *Config
	auth  *Auth
	brain *Brain

	// Usage cache
	usageCache   any
	usageCacheTs time.Time
	usageOk      bool
	usageMu      sync.Mutex

	// Git repos (discovered once at startup)
	gitRepos []GitRepo
}

func (a *API) RegisterRoutes(mux *http.ServeMux) {
	// Discover git repos
	a.gitRepos = DiscoverGitRepos(a.cfg)
	a.usageOk = true

	// Auth (no auth required)
	mux.HandleFunc("GET /api/auth/check", a.authCheck)
	mux.HandleFunc("POST /api/auth/login", a.authLogin)
	mux.HandleFunc("POST /api/auth/logout", a.authLogout)

	// Protected routes
	mux.HandleFunc("GET /api/settings", a.auth.RequireAuth(a.getSettings))
	mux.HandleFunc("PUT /api/settings", a.auth.RequireAuth(a.putSettings))
	mux.HandleFunc("GET /api/tmux-session", a.auth.RequireAuth(a.tmuxSession))
	mux.HandleFunc("GET /api/tmux-capture", a.auth.RequireAuth(a.tmuxCapture))
	mux.HandleFunc("GET /api/claude-sessions", a.auth.RequireAuth(a.claudeSessions))
	mux.HandleFunc("POST /api/claude-send", a.auth.RequireAuth(a.claudeSend))
	mux.HandleFunc("POST /api/claude-new", a.auth.RequireAuth(a.claudeNew))
	mux.HandleFunc("GET /api/notes", a.auth.RequireAuth(a.listNotes))
	mux.HandleFunc("POST /api/notes", a.auth.RequireAuth(a.createNote))
	mux.HandleFunc("GET /api/notes/{id}", a.auth.RequireAuth(a.getNote))
	mux.HandleFunc("PUT /api/notes/{id}", a.auth.RequireAuth(a.updateNote))
	mux.HandleFunc("DELETE /api/notes/{id}", a.auth.RequireAuth(a.deleteNote))
	mux.HandleFunc("GET /api/brain", a.auth.RequireAuth(a.brainTree))
	mux.HandleFunc("GET /api/brain/read", a.auth.RequireAuth(a.brainRead))
	mux.HandleFunc("PUT /api/brain/write", a.auth.RequireAuth(a.brainWrite))
	mux.HandleFunc("GET /api/server-status", a.auth.RequireAuth(a.serverStatus))
	mux.HandleFunc("GET /api/git-status", a.auth.RequireAuth(a.gitStatus))
	mux.HandleFunc("GET /api/claude-usage", a.auth.RequireAuth(a.claudeUsage))
	mux.HandleFunc("GET /api/notifications", a.auth.RequireAuth(a.notifications))
	mux.HandleFunc("POST /upload", a.auth.RequireAuth(a.uploadFile))
}

// --- JSON helpers ---

func jsonResponse(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(data)
}

func readJSON(r *http.Request) (M, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	if len(body) == 0 {
		return M{}, nil
	}
	var m M
	err = json.Unmarshal(body, &m)
	return m, err
}

func setSessionCookie(w http.ResponseWriter, cfg *Config, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cfg.CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   cfg.SessionMaxAge,
		HttpOnly: true,
		Secure:   cfg.Domain != "",
		SameSite: http.SameSiteStrictMode,
	})
}

func clearSessionCookie(w http.ResponseWriter, cfg *Config) {
	http.SetCookie(w, &http.Cookie{
		Name:     cfg.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   0,
		HttpOnly: true,
		Secure:   cfg.Domain != "",
		SameSite: http.SameSiteStrictMode,
	})
}

// --- tmux helpers ---

func (a *API) tmux(args ...string) (string, error) {
	cmd := exec.Command("tmux", append([]string{"-S", a.cfg.TmuxSocket}, args...)...)
	out, err := cmd.Output()
	return string(out), err
}

func runCmd(args []string, cwd string, timeout time.Duration) (string, error) {
	cmd := exec.Command(args[0], args[1:]...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	done := make(chan struct{})
	var out []byte
	var err error
	go func() {
		out, err = cmd.Output()
		close(done)
	}()
	select {
	case <-done:
		return string(out), err
	case <-time.After(timeout):
		cmd.Process.Kill()
		return "", fmt.Errorf("timeout")
	}
}

// ═══════════════════════════════════════════════════════════
// Authentication
// ═══════════════════════════════════════════════════════════

func (a *API) authCheck(w http.ResponseWriter, r *http.Request) {
	a.auth.CleanupSessions()
	token := getSessionToken(r, a.cfg.CookieName)
	authenticated := a.auth.ValidateSession(token)
	jsonResponse(w, 200, M{"authenticated": authenticated})
}

func (a *API) authLogin(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	password, _ := body["password"].(string)
	ip := getClientIP(r)

	if !a.auth.CheckRateLimit(ip) {
		jsonResponse(w, 429, M{"error": "Too many attempts. Try again later."})
		return
	}

	if !a.auth.VerifyPassword(password) {
		a.auth.RecordFailedAttempt(ip)
		jsonResponse(w, 401, M{"error": "Wrong password"})
		return
	}

	a.auth.ResetAttempts(ip)
	token := a.auth.CreateSession(ip)
	setSessionCookie(w, a.cfg, token)
	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) authLogout(w http.ResponseWriter, r *http.Request) {
	token := getSessionToken(r, a.cfg.CookieName)
	if token != "" {
		a.auth.DestroySession(token)
	}
	clearSessionCookie(w, a.cfg)
	jsonResponse(w, 200, M{"ok": true})
}

// ═══════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(a.cfg.SettingsFile)
	if err != nil {
		jsonResponse(w, 200, M{
			"general":  M{"wakeLock": false, "fontSize": 16, "notification": false},
			"snippets": []any{},
		})
		return
	}
	var settings any
	if err := json.Unmarshal(data, &settings); err != nil {
		jsonResponse(w, 200, M{
			"general":  M{"wakeLock": false, "fontSize": 16, "notification": false},
			"snippets": []any{},
		})
		return
	}
	jsonResponse(w, 200, settings)
}

func (a *API) putSettings(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	os.MkdirAll(filepath.Dir(a.cfg.SettingsFile), 0755)
	data, _ := json.MarshalIndent(body, "", "  ")
	tmpFile := a.cfg.SettingsFile + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	os.Rename(tmpFile, a.cfg.SettingsFile)
	jsonResponse(w, 200, M{"ok": true})
}

// ═══════════════════════════════════════════════════════════
// Terminal / tmux
// ═══════════════════════════════════════════════════════════

func (a *API) tmuxSession(w http.ResponseWriter, r *http.Request) {
	out, err := a.tmux("display-message", "-p", "#S:#I.#W")
	if err != nil {
		jsonResponse(w, 200, M{"session": "unknown"})
		return
	}
	info := strings.TrimSpace(out)
	if info == "" {
		info = "unknown"
	}
	jsonResponse(w, 200, M{"session": info})
}

func (a *API) tmuxCapture(w http.ResponseWriter, r *http.Request) {
	args := []string{"capture-pane", "-p"}
	if r.URL.Query().Get("history") == "1" {
		args = append(args, "-S", "-500")
	}
	out, err := a.tmux(args...)
	if err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	jsonResponse(w, 200, M{"text": out})
}

func (a *API) claudeSessions(w http.ResponseWriter, r *http.Request) {
	format := "#{session_name}:#{window_index}.#{pane_index}|||#{pane_title}|||#{pane_current_command}"
	out, err := a.tmux("list-panes", "-a", "-F", format)
	if err != nil {
		jsonResponse(w, 200, M{"sessions": []any{}})
		return
	}

	var sessions []M
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|||", 3)
		if len(parts) < 3 {
			continue
		}
		title := parts[1]
		if title == "" {
			title = parts[2]
		}
		sessions = append(sessions, M{
			"target":   parts[0],
			"title":    title,
			"rawTitle": parts[1],
		})
	}
	if sessions == nil {
		sessions = []M{}
	}
	jsonResponse(w, 200, M{"sessions": sessions})
}

func (a *API) claudeSend(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	target, _ := body["target"].(string)
	text, _ := body["text"].(string)

	targetRe := regexp.MustCompile(`^[\w-]+:\d+\.\d+$`)
	if !targetRe.MatchString(target) {
		jsonResponse(w, 400, M{"error": "Invalid target"})
		return
	}

	tmpFile, err := os.CreateTemp("", "claude-send-*.txt")
	if err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	tmpFile.WriteString(text)
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	if _, err := a.tmux("load-buffer", tmpPath); err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	if _, err := a.tmux("paste-buffer", "-t", target); err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) claudeNew(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	text, _ := body["text"].(string)

	tmpFile, err := os.CreateTemp("", "claude-new-*.txt")
	if err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	tmpFile.WriteString(text)
	tmpPath := tmpFile.Name()
	tmpFile.Close()

	cmd := fmt.Sprintf("cat '%s' | %s -p; rm -f '%s'", tmpPath, a.cfg.ClaudeCmd, tmpPath)
	out, err := a.tmux("new-window", "-P", "-F", "#{window_index}", "-n", "claude", fmt.Sprintf("bash -c \"%s\"", cmd))
	if err != nil {
		os.Remove(tmpPath)
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	windowIdx := strings.TrimSpace(out)
	if windowIdx != "" {
		a.tmux("select-window", "-t", ":"+windowIdx)
	}
	jsonResponse(w, 200, M{"ok": true, "window": windowIdx})
}

// ═══════════════════════════════════════════════════════════
// Notes
// ═══════════════════════════════════════════════════════════

var noteIDRe = regexp.MustCompile(`^[a-f0-9]{8}$`)

func (a *API) notePath(id string) string {
	return filepath.Join(a.cfg.NotesDir, id+".json")
}

func (a *API) listNotes(w http.ResponseWriter, r *http.Request) {
	os.MkdirAll(a.cfg.NotesDir, 0755)
	entries, _ := os.ReadDir(a.cfg.NotesDir)
	var notes []M
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		noteID := strings.TrimSuffix(e.Name(), ".json")
		data, err := os.ReadFile(filepath.Join(a.cfg.NotesDir, e.Name()))
		if err != nil {
			continue
		}
		var note M
		if json.Unmarshal(data, &note) != nil {
			continue
		}
		content, _ := note["content"].(string)
		preview := content
		if len(preview) > 80 {
			preview = preview[:80]
		}
		notes = append(notes, M{
			"id":        noteID,
			"title":     note["title"],
			"preview":   preview,
			"updatedAt": note["updatedAt"],
			"createdAt": note["createdAt"],
		})
	}
	// Sort by updatedAt desc
	if notes == nil {
		notes = []M{}
	}
	jsonResponse(w, 200, M{"notes": notes})
}

func (a *API) createNote(w http.ResponseWriter, r *http.Request) {
	body, _ := readJSON(r)
	noteID := uuid.New().String()[:8]
	now := time.Now().UnixMilli()
	title, _ := body["title"].(string)
	content, _ := body["content"].(string)
	note := M{
		"title":     title,
		"content":   content,
		"createdAt": now,
		"updatedAt": now,
	}
	data, _ := json.MarshalIndent(note, "", "  ")
	os.MkdirAll(a.cfg.NotesDir, 0755)
	os.WriteFile(a.notePath(noteID), data, 0644)
	jsonResponse(w, 200, M{"id": noteID})
}

func (a *API) getNote(w http.ResponseWriter, r *http.Request) {
	noteID := r.PathValue("id")
	if !noteIDRe.MatchString(noteID) {
		jsonResponse(w, 400, M{"error": "Invalid note ID"})
		return
	}
	data, err := os.ReadFile(a.notePath(noteID))
	if err != nil {
		jsonResponse(w, 404, M{"error": "Note not found"})
		return
	}
	var note any
	json.Unmarshal(data, &note)
	jsonResponse(w, 200, note)
}

func (a *API) updateNote(w http.ResponseWriter, r *http.Request) {
	noteID := r.PathValue("id")
	if !noteIDRe.MatchString(noteID) {
		jsonResponse(w, 400, M{"error": "Invalid note ID"})
		return
	}
	existing, err := os.ReadFile(a.notePath(noteID))
	if err != nil {
		jsonResponse(w, 404, M{"error": "Note not found"})
		return
	}
	var note M
	json.Unmarshal(existing, &note)

	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	if t, ok := body["title"]; ok {
		note["title"] = t
	}
	if c, ok := body["content"]; ok {
		note["content"] = c
	}
	note["updatedAt"] = time.Now().UnixMilli()

	data, _ := json.MarshalIndent(note, "", "  ")
	os.WriteFile(a.notePath(noteID), data, 0644)
	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) deleteNote(w http.ResponseWriter, r *http.Request) {
	noteID := r.PathValue("id")
	if !noteIDRe.MatchString(noteID) {
		jsonResponse(w, 400, M{"error": "Invalid note ID"})
		return
	}
	if err := os.Remove(a.notePath(noteID)); err != nil {
		jsonResponse(w, 404, M{"error": "Note not found"})
		return
	}
	jsonResponse(w, 200, M{"ok": true})
}

// ═══════════════════════════════════════════════════════════
// Brain
// ═══════════════════════════════════════════════════════════

func (a *API) brainTree(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, 200, M{"scopes": a.brain.Scan()})
}

func (a *API) brainRead(w http.ResponseWriter, r *http.Request) {
	dirpath := r.URL.Query().Get("dir")
	filename := r.URL.Query().Get("file")

	fullPath, writable := a.brain.ResolvePath(dirpath, filename)
	if fullPath == "" {
		jsonResponse(w, 404, M{"error": "File not found"})
		return
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	info, _ := os.Stat(fullPath)
	jsonResponse(w, 200, M{
		"content":  string(content),
		"path":     fullPath,
		"size":     info.Size(),
		"writable": writable,
	})
}

func (a *API) brainWrite(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	dirpath, _ := body["dir"].(string)
	filename, _ := body["file"].(string)
	content, _ := body["content"].(string)

	fullPath, writable := a.brain.ResolvePath(dirpath, filename)
	if fullPath == "" {
		jsonResponse(w, 404, M{"error": "File not found"})
		return
	}
	if !writable {
		jsonResponse(w, 403, M{"error": "File is read-only"})
		return
	}

	if err := os.WriteFile(fullPath, []byte(content), 0644); err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	jsonResponse(w, 200, M{"ok": true})
}

// ═══════════════════════════════════════════════════════════
// System
// ═══════════════════════════════════════════════════════════

func (a *API) serverStatus(w http.ResponseWriter, r *http.Request) {
	result := M{}

	// CPU load
	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			loadAvg := 0.0
			fmt.Sscanf(fields[0], "%f", &loadAvg)
			cpuCount := 4 // default
			if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
				cpuCount = strings.Count(string(data), "processor\t:")
				if cpuCount == 0 {
					cpuCount = 4
				}
			}
			result["cpu"] = round1(loadAvg / float64(cpuCount) * 100)
			result["loadAvg"] = loadAvg
		}
	}

	// Memory
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		memInfo := make(map[string]int64)
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				key := strings.TrimSuffix(fields[0], ":")
				val, _ := strconv.ParseInt(fields[1], 10, 64)
				memInfo[key] = val
			}
		}
		total := memInfo["MemTotal"]
		avail := memInfo["MemAvailable"]
		if total > 0 {
			used := total - avail
			result["mem"] = round1(float64(used) / float64(total) * 100)
			result["memUsedGB"] = round1(float64(used) / 1048576)
			result["memTotalGB"] = round1(float64(total) / 1048576)
		}
	}

	// Disk
	// Use syscall-free approach via df command
	if out, err := runCmd([]string{"df", "-B1", "/"}, "", 3*time.Second); err == nil {
		lines := strings.Split(out, "\n")
		if len(lines) >= 2 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 5 {
				total, _ := strconv.ParseInt(fields[1], 10, 64)
				used, _ := strconv.ParseInt(fields[2], 10, 64)
				if total > 0 {
					result["disk"] = round1(float64(used) / float64(total) * 100)
				}
			}
		}
	}

	// Temperature
	if data, err := os.ReadFile("/sys/class/thermal/thermal_zone0/temp"); err == nil {
		tempStr := strings.TrimSpace(string(data))
		if temp, err := strconv.ParseFloat(tempStr, 64); err == nil {
			result["temp"] = round1(temp / 1000)
		}
	}

	jsonResponse(w, 200, result)
}

func (a *API) gitStatus(w http.ResponseWriter, r *http.Request) {
	if len(a.gitRepos) == 0 {
		jsonResponse(w, 200, M{"repos": []any{}})
		return
	}

	var repos []M
	for _, repo := range a.gitRepos {
		data := scanGitRepo(repo.Path)
		data["id"] = repo.ID
		data["path"] = repo.Path
		repos = append(repos, data)
	}

	// Response with backward compatibility
	response := M{"repos": repos}
	if len(repos) > 0 {
		first := repos[0]
		if _, ok := first["branch"]; ok {
			response["branch"] = first["branch"]
			response["changes"] = first["changes"]
			response["commits"] = first["commits"]
			response["ahead"] = first["ahead"]
			response["behind"] = first["behind"]
			if files, ok := first["files"].([]M); ok {
				var fileStrs []string
				for _, f := range files {
					status, _ := f["status"].(string)
					file, _ := f["file"].(string)
					fileStrs = append(fileStrs, fmt.Sprintf("%-2s %s", status, file))
				}
				response["files"] = fileStrs
			}
		}
	}
	jsonResponse(w, 200, response)
}

func scanGitRepo(gitDir string) M {
	branchOut, _ := runCmd([]string{"git", "branch", "--show-current"}, gitDir, 3*time.Second)
	branch := strings.TrimSpace(branchOut)

	statusOut, _ := runCmd([]string{"git", "status", "--porcelain"}, gitDir, 5*time.Second)
	staged, modified, untracked := 0, 0, 0
	var files []M
	for _, line := range strings.Split(statusOut, "\n") {
		if len(line) < 3 {
			continue
		}
		code := line[:2]
		fname := line[3:]
		if code[0] != ' ' && code[0] != '?' {
			staged++
		}
		if code[1] == 'M' || code[1] == 'D' {
			modified++
		}
		if code == "??" {
			untracked++
		}
		files = append(files, M{"status": strings.TrimSpace(code), "file": fname})
	}

	logOut, _ := runCmd([]string{"git", "log", "--oneline", "--no-merges", "-10", "--format=%h|||%s|||%ar"}, gitDir, 5*time.Second)
	var commits []M
	for _, line := range strings.Split(strings.TrimSpace(logOut), "\n") {
		parts := strings.SplitN(line, "|||", 3)
		if len(parts) < 3 {
			continue
		}
		commits = append(commits, M{
			"hash": parts[0], "message": parts[1],
			"time": parts[2], "ago": parts[2],
		})
	}

	ahead, behind := 0, 0
	if abOut, err := runCmd([]string{"git", "rev-list", "--left-right", "--count", "@{u}...HEAD"}, gitDir, 5*time.Second); err == nil {
		parts := strings.Fields(strings.TrimSpace(abOut))
		if len(parts) == 2 {
			behind, _ = strconv.Atoi(parts[0])
			ahead, _ = strconv.Atoi(parts[1])
		}
	}

	total := staged + modified + untracked
	if files == nil {
		files = []M{}
	}
	if commits == nil {
		commits = []M{}
	}

	return M{
		"branch":  branch,
		"changes": M{"staged": staged, "modified": modified, "unstaged": modified, "untracked": untracked, "total": total},
		"files":   files,
		"commits": commits,
		"ahead":   ahead,
		"behind":  behind,
	}
}

func (a *API) claudeUsage(w http.ResponseWriter, r *http.Request) {
	a.usageMu.Lock()
	defer a.usageMu.Unlock()

	cacheTTL := 60 * time.Second
	if !a.usageOk {
		cacheTTL = 5 * time.Minute
	}
	if a.usageCache != nil && time.Since(a.usageCacheTs) < cacheTTL {
		jsonResponse(w, 200, a.usageCache)
		return
	}

	credsPath := filepath.Join(a.cfg.HomeDir, ".claude", ".credentials.json")
	credsData, err := os.ReadFile(credsPath)
	if err != nil {
		a.usageOk = false
		a.usageCacheTs = time.Now()
		jsonResponse(w, 500, M{"error": "Cannot read credentials"})
		return
	}

	var creds M
	json.Unmarshal(credsData, &creds)
	oauth, _ := creds["claudeAiOauth"].(map[string]any)
	token, _ := oauth["accessToken"].(string)

	if token == "" {
		a.usageOk = false
		a.usageCacheTs = time.Now()
		jsonResponse(w, 500, M{"error": "No access token"})
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", "https://api.claude.ai/api/organizations/usage", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		a.usageOk = false
		a.usageCacheTs = time.Now()
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	var data any
	json.NewDecoder(resp.Body).Decode(&data)
	a.usageCache = data
	a.usageCacheTs = time.Now()
	a.usageOk = true
	jsonResponse(w, 200, data)
}

func (a *API) notifications(w http.ResponseWriter, r *http.Request) {
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	var result []M

	entries, err := os.ReadDir(a.cfg.NotifyDir)
	if err == nil {
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			tsStr := strings.TrimSuffix(e.Name(), ".json")
			ts, err := strconv.ParseInt(tsStr, 10, 64)
			if err != nil || ts <= since {
				continue
			}
			data, err := os.ReadFile(filepath.Join(a.cfg.NotifyDir, e.Name()))
			if err != nil {
				continue
			}
			var notification M
			if json.Unmarshal(data, &notification) == nil {
				notification["timestamp"] = ts
				result = append(result, notification)
			}
		}
	}

	if result == nil {
		result = []M{}
	}
	jsonResponse(w, 200, M{"notifications": result})
}

// ═══════════════════════════════════════════════════════════
// Upload
// ═══════════════════════════════════════════════════════════

func (a *API) uploadFile(w http.ResponseWriter, r *http.Request) {
	length := r.ContentLength
	if length <= 0 {
		jsonResponse(w, 400, M{"error": "No content"})
		return
	}
	if length > 100*1024*1024 {
		jsonResponse(w, 413, M{"error": "File too large"})
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		jsonResponse(w, 500, M{"error": err.Error()})
		return
	}

	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	exts, _ := mime.ExtensionsByType(contentType)
	ext := ".bin"
	if len(exts) > 0 {
		ext = exts[0]
		if ext == ".jpe" {
			ext = ".jpg"
		}
	}

	os.MkdirAll(a.cfg.UploadDir, 0755)
	filename := uuid.New().String()[:8] + ext
	filePath := filepath.Join(a.cfg.UploadDir, filename)
	os.WriteFile(filePath, body, 0644)

	jsonResponse(w, 200, M{"path": filePath})
}

// --- Helpers ---

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}
