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
	"runtime"
	"sort"
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
	push  *PushManager
	totp  *TOTP

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

	// TOTP (2FA)
	mux.HandleFunc("GET /api/totp/status", a.totpStatus)
	mux.HandleFunc("POST /api/totp/setup", a.auth.RequireAuth(a.totpSetup))
	mux.HandleFunc("POST /api/totp/verify-setup", a.auth.RequireAuth(a.totpVerifySetup))
	mux.HandleFunc("POST /api/totp/disable", a.auth.RequireAuth(a.totpDisable))

	// Protected routes
	mux.HandleFunc("GET /api/settings", a.auth.RequireAuth(a.getSettings))
	mux.HandleFunc("PUT /api/settings", a.auth.RequireAuth(a.putSettings))
	mux.HandleFunc("GET /api/tmux-session", a.auth.RequireAuth(a.tmuxSession))
	mux.HandleFunc("GET /api/tmux-capture", a.auth.RequireAuth(a.tmuxCapture))
	mux.HandleFunc("POST /api/tmux-scroll-bottom", a.auth.RequireAuth(a.tmuxScrollBottom))
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

	// Push notifications
	mux.HandleFunc("GET /api/push/vapid-key", a.auth.RequireAuth(a.pushVAPIDKey))
	mux.HandleFunc("POST /api/push/subscribe", a.auth.RequireAuth(a.pushSubscribe))
	mux.HandleFunc("DELETE /api/push/subscribe", a.auth.RequireAuth(a.pushUnsubscribe))
	mux.HandleFunc("POST /api/push/test", a.auth.RequireAuth(a.pushTest))

	// Launch tracker
	mux.HandleFunc("GET /api/launch/status", a.auth.RequireAuth(a.launchStatus))
	mux.HandleFunc("GET /api/launch/items", a.auth.RequireAuth(a.launchGetItems))
	mux.HandleFunc("POST /api/launch/items", a.auth.RequireAuth(a.launchAddItem))
	mux.HandleFunc("PATCH /api/launch/items/{id}", a.auth.RequireAuth(a.launchUpdateItem))
	mux.HandleFunc("DELETE /api/launch/items/{id}", a.auth.RequireAuth(a.launchDeleteItem))
	mux.HandleFunc("GET /api/launch/config", a.auth.RequireAuth(a.launchGetConfig))
	mux.HandleFunc("PUT /api/launch/config", a.auth.RequireAuth(a.launchUpdateConfig))
	mux.HandleFunc("GET /api/launch/history", a.auth.RequireAuth(a.launchGetHistory))
	mux.HandleFunc("POST /api/launch/seed", a.auth.RequireAuth(a.launchSeed))

	// Monitor (claude-loop)
	mux.HandleFunc("GET /api/monitor", a.auth.RequireAuth(a.monitorList))
	mux.HandleFunc("GET /api/monitor/{name}", a.auth.RequireAuth(a.monitorDetail))
	mux.HandleFunc("POST /api/monitor/{name}/feedback", a.auth.RequireAuth(a.monitorSaveFeedback))
	mux.HandleFunc("POST /api/monitor/{name}/stop", a.auth.RequireAuth(a.monitorStop))

	// Domain / Tunnel
	mux.HandleFunc("GET /api/tunnel-url", a.auth.RequireAuth(a.tunnelURL))
	mux.HandleFunc("GET /api/domain", a.auth.RequireAuth(a.getDomain))
	mux.HandleFunc("PUT /api/domain", a.auth.RequireAuth(a.setDomain))

	// Files explorer
	a.registerFileRoutes(mux)
	a.registerFileEditRoute(mux)
}

// --- JSON helpers ---

func jsonResponse(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(data)
}

func readJSON(r *http.Request) (M, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB max
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
	cmd := exec.Command(a.cfg.TmuxBin, append([]string{"-S", a.cfg.TmuxSocket}, args...)...)
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
	ip := getClientIP(r, a.cfg.TrustProxy)

	if !a.auth.CheckRateLimit(ip) {
		jsonResponse(w, 429, M{"error": "Too many attempts. Try again later."})
		return
	}

	if !a.auth.VerifyPassword(password) {
		a.auth.RecordFailedAttempt(ip)
		jsonResponse(w, 401, M{"error": "Wrong password"})
		return
	}

	// Check TOTP
	if a.totp.IsEnabled() {
		totpCode, _ := body["totp_code"].(string)
		if totpCode == "" {
			// Password OK, but need TOTP
			jsonResponse(w, 200, M{"totp_required": true})
			return
		}
		// Try TOTP code first, then recovery code
		if !a.totp.ValidateCurrentCode(totpCode) && !a.totp.UseRecoveryCode(totpCode) {
			a.auth.RecordFailedAttempt(ip)
			jsonResponse(w, 401, M{"error": "Invalid verification code"})
			return
		}
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
// TOTP (2FA)
// ═══════════════════════════════════════════════════════════

// pending TOTP setup (in-memory, not persisted until verified)
var pendingTOTPSecret string
var pendingTOTPRecovery []string
var pendingTOTPMu sync.Mutex

func (a *API) totpStatus(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, 200, M{"enabled": a.totp.IsEnabled()})
}

func (a *API) totpSetup(w http.ResponseWriter, r *http.Request) {
	if a.totp.IsEnabled() {
		jsonResponse(w, 400, M{"error": "TOTP already enabled"})
		return
	}
	pendingTOTPMu.Lock()
	pendingTOTPSecret = a.totp.GenerateSecret()
	pendingTOTPRecovery = a.totp.GenerateRecoveryCodes()
	pendingTOTPMu.Unlock()

	uri := a.totp.OTPAuthURI(pendingTOTPSecret, "ClaudeTerminal")
	jsonResponse(w, 200, M{
		"secret":         pendingTOTPSecret,
		"uri":            uri,
		"recovery_codes": pendingTOTPRecovery,
	})
}

func (a *API) totpVerifySetup(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	code, _ := body["code"].(string)

	pendingTOTPMu.Lock()
	secret := pendingTOTPSecret
	recovery := pendingTOTPRecovery
	pendingTOTPMu.Unlock()

	if secret == "" {
		jsonResponse(w, 400, M{"error": "No pending TOTP setup"})
		return
	}
	if !a.totp.ValidateCode(secret, code) {
		jsonResponse(w, 401, M{"error": "Invalid code"})
		return
	}
	if err := a.totp.Enable(secret, recovery); err != nil {
		jsonResponse(w, 500, M{"error": "Failed to save TOTP"})
		return
	}

	pendingTOTPMu.Lock()
	pendingTOTPSecret = ""
	pendingTOTPRecovery = nil
	pendingTOTPMu.Unlock()

	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) totpDisable(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	password, _ := body["password"].(string)
	if !a.auth.VerifyPassword(password) {
		jsonResponse(w, 401, M{"error": "Wrong password"})
		return
	}
	a.totp.Disable()
	jsonResponse(w, 200, M{"ok": true})
}

// ═══════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════

func defaultSnippets() []M {
	return []M{
		{"id": "s1", "label": "Claude", "command": "claude", "color": "blue", "confirm": false, "newWindow": true},
		{"id": "s2", "label": "Resume", "command": "/resume", "color": "default", "confirm": false},
		{"id": "s3", "label": "Compact", "command": "/compact", "color": "default", "confirm": false},
	}
}

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(a.cfg.SettingsFile)
	if err != nil {
		jsonResponse(w, 200, M{
			"general":  M{"wakeLock": false, "fontSize": 16, "notification": false},
			"snippets": defaultSnippets(),
		})
		return
	}
	var settings any
	if err := json.Unmarshal(data, &settings); err != nil {
		jsonResponse(w, 200, M{
			"general":  M{"wakeLock": false, "fontSize": 16, "notification": false},
			"snippets": defaultSnippets(),
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
	if err := os.WriteFile(tmpFile, data, 0600); err != nil {
		jsonResponse(w, 500, M{"error": "Failed to save settings"})
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
		jsonResponse(w, 500, M{"error": "Failed to capture pane"})
		return
	}
	jsonResponse(w, 200, M{"text": out})
}

func (a *API) tmuxScrollBottom(w http.ResponseWriter, r *http.Request) {
	// Check if pane is in copy-mode
	out, err := a.tmux("display-message", "-p", "#{pane_in_mode}")
	if err != nil {
		jsonResponse(w, 200, M{"ok": true, "copyMode": false})
		return
	}
	inMode := strings.TrimSpace(out) == "1"
	if inMode {
		// Safe exit: send-keys -X cancel only affects copy-mode, not the running process
		a.tmux("send-keys", "-X", "cancel")
	}
	jsonResponse(w, 200, M{"ok": true, "copyMode": inMode})
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
		jsonResponse(w, 500, M{"error": "Failed to create temp file"})
		return
	}
	tmpFile.WriteString(text)
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	if _, err := a.tmux("load-buffer", tmpPath); err != nil {
		jsonResponse(w, 500, M{"error": "Failed to load buffer"})
		return
	}
	if _, err := a.tmux("paste-buffer", "-t", target); err != nil {
		jsonResponse(w, 500, M{"error": "Failed to paste buffer"})
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
		jsonResponse(w, 500, M{"error": "Failed to create temp file"})
		return
	}
	tmpFile.WriteString(text)
	tmpPath := tmpFile.Name()
	tmpFile.Close()

	// Use a script with explicit args to avoid shell injection
	script := fmt.Sprintf("cat %q | %q -p; rm -f %q", tmpPath, a.cfg.ClaudeCmd, tmpPath)
	out, err := a.tmux("new-window", "-P", "-F", "#{window_index}", "-n", "claude", "bash", "-c", script)
	if err != nil {
		os.Remove(tmpPath)
		jsonResponse(w, 500, M{"error": "Failed to create window"})
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
		pinned, _ := note["pinned"].(bool)
		notes = append(notes, M{
			"id":        noteID,
			"title":     note["title"],
			"preview":   preview,
			"updatedAt": note["updatedAt"],
			"createdAt": note["createdAt"],
			"pinned":    pinned,
		})
	}
	// Sort: pinned first, then by updatedAt desc
	sort.Slice(notes, func(i, j int) bool {
		ip, _ := notes[i]["pinned"].(bool)
		jp, _ := notes[j]["pinned"].(bool)
		if ip != jp {
			return ip
		}
		it, _ := notes[i]["updatedAt"].(float64)
		jt, _ := notes[j]["updatedAt"].(float64)
		return it > jt
	})
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
	os.WriteFile(a.notePath(noteID), data, 0600)
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
	if p, ok := body["pinned"]; ok {
		note["pinned"] = p
	}
	note["updatedAt"] = time.Now().UnixMilli()

	data, _ := json.MarshalIndent(note, "", "  ")
	os.WriteFile(a.notePath(noteID), data, 0600)
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
		jsonResponse(w, 500, M{"error": "Failed to read file"})
		return
	}
	info, _ := os.Stat(fullPath)
	jsonResponse(w, 200, M{
		"content":  string(content),
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
		jsonResponse(w, 500, M{"error": "Failed to write file"})
		return
	}
	jsonResponse(w, 200, M{"ok": true})
}

// ═══════════════════════════════════════════════════════════
// System
// ═══════════════════════════════════════════════════════════

func (a *API) serverStatus(w http.ResponseWriter, r *http.Request) {
	result := M{}

	if runtime.GOOS == "darwin" {
		a.serverStatusDarwin(result)
	} else {
		a.serverStatusLinux(result)
	}

	// Disk (cross-platform via df)
	dfArgs := []string{"df", "/"}
	if runtime.GOOS == "linux" {
		dfArgs = []string{"df", "-B1", "/"}
	}
	if out, err := runCmd(dfArgs, "", 3*time.Second); err == nil {
		lines := strings.Split(out, "\n")
		if len(lines) >= 2 {
			fields := strings.Fields(lines[1])
			if runtime.GOOS == "darwin" && len(fields) >= 5 {
				// macOS df: 512-byte blocks
				total, _ := strconv.ParseInt(fields[1], 10, 64)
				used, _ := strconv.ParseInt(fields[2], 10, 64)
				if total > 0 {
					result["disk"] = round1(float64(used) / float64(total) * 100)
				}
			} else if len(fields) >= 5 {
				total, _ := strconv.ParseInt(fields[1], 10, 64)
				used, _ := strconv.ParseInt(fields[2], 10, 64)
				if total > 0 {
					result["disk"] = round1(float64(used) / float64(total) * 100)
				}
			}
		}
	}

	jsonResponse(w, 200, result)
}

func (a *API) serverStatusLinux(result M) {
	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			loadAvg := 0.0
			fmt.Sscanf(fields[0], "%f", &loadAvg)
			cpuCount := 4
			if cpuData, err := os.ReadFile("/proc/cpuinfo"); err == nil {
				cpuCount = strings.Count(string(cpuData), "processor\t:")
				if cpuCount == 0 {
					cpuCount = 4
				}
			}
			result["cpu"] = round1(loadAvg / float64(cpuCount) * 100)
			result["loadAvg"] = loadAvg
		}
	}
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
	if data, err := os.ReadFile("/sys/class/thermal/thermal_zone0/temp"); err == nil {
		tempStr := strings.TrimSpace(string(data))
		if temp, err := strconv.ParseFloat(tempStr, 64); err == nil {
			result["temp"] = round1(temp / 1000)
		}
	}
}

func (a *API) serverStatusDarwin(result M) {
	// CPU load
	if out, err := runCmd([]string{"sysctl", "-n", "vm.loadavg"}, "", 3*time.Second); err == nil {
		trimmed := strings.Trim(strings.TrimSpace(out), "{ }")
		fields := strings.Fields(trimmed)
		if len(fields) > 0 {
			loadAvg := 0.0
			fmt.Sscanf(fields[0], "%f", &loadAvg)
			cpuCount := 4
			if cpuOut, err := runCmd([]string{"sysctl", "-n", "hw.ncpu"}, "", 3*time.Second); err == nil {
				if n, err := strconv.Atoi(strings.TrimSpace(cpuOut)); err == nil && n > 0 {
					cpuCount = n
				}
			}
			result["cpu"] = round1(loadAvg / float64(cpuCount) * 100)
			result["loadAvg"] = loadAvg
		}
	}
	// Memory
	if out, err := runCmd([]string{"vm_stat"}, "", 3*time.Second); err == nil {
		pageSize := int64(16384)
		if psOut, err := runCmd([]string{"sysctl", "-n", "hw.pagesize"}, "", 3*time.Second); err == nil {
			if ps, err := strconv.ParseInt(strings.TrimSpace(psOut), 10, 64); err == nil {
				pageSize = ps
			}
		}
		stats := make(map[string]int64)
		for _, line := range strings.Split(out, "\n") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				valStr := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(parts[1]), "."))
				if val, err := strconv.ParseInt(valStr, 10, 64); err == nil {
					stats[key] = val
				}
			}
		}
		if memOut, err := runCmd([]string{"sysctl", "-n", "hw.memsize"}, "", 3*time.Second); err == nil {
			totalBytes, _ := strconv.ParseInt(strings.TrimSpace(memOut), 10, 64)
			if totalBytes > 0 {
				free := (stats["Pages free"] + stats["Pages speculative"]) * pageSize
				inactive := stats["Pages inactive"] * pageSize
				available := free + inactive
				used := totalBytes - available
				result["mem"] = round1(float64(used) / float64(totalBytes) * 100)
				result["memUsedGB"] = round1(float64(used) / (1024 * 1024 * 1024))
				result["memTotalGB"] = round1(float64(totalBytes) / (1024 * 1024 * 1024))
			}
		}
	}
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

	client := &http.Client{Timeout: 15 * time.Second}
	body := `{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")

	resp, err := client.Do(req)
	if err != nil {
		a.usageOk = false
		a.usageCacheTs = time.Now()
		jsonResponse(w, 500, M{"error": "Failed to fetch usage"})
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != 200 {
		a.usageOk = false
		a.usageCacheTs = time.Now()
		jsonResponse(w, 500, M{"error": "API error: " + resp.Status})
		return
	}

	// Parse rate limit headers
	h := resp.Header
	data := M{}
	if v := h.Get("anthropic-ratelimit-unified-5h-utilization"); v != "" {
		data["five_hour"] = M{
			"utilization": v,
			"resets_at":   h.Get("anthropic-ratelimit-unified-5h-reset"),
			"status":      h.Get("anthropic-ratelimit-unified-5h-status"),
		}
	}
	if v := h.Get("anthropic-ratelimit-unified-7d-utilization"); v != "" {
		data["seven_day"] = M{
			"utilization": v,
			"resets_at":   h.Get("anthropic-ratelimit-unified-7d-reset"),
			"status":      h.Get("anthropic-ratelimit-unified-7d-status"),
		}
	}
	data["status"] = h.Get("anthropic-ratelimit-unified-status")
	data["representative_claim"] = h.Get("anthropic-ratelimit-unified-representative-claim")
	data["fallback_percentage"] = h.Get("anthropic-ratelimit-unified-fallback-percentage")
	data["overage_status"] = h.Get("anthropic-ratelimit-unified-overage-status")
	data["overage_disabled_reason"] = h.Get("anthropic-ratelimit-unified-overage-disabled-reason")

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
	const maxUpload = 100 * 1024 * 1024 // 100MB
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload)

	body, err := io.ReadAll(r.Body)
	if err != nil {
		jsonResponse(w, 413, M{"error": "Upload too large"})
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

// ═══════════════════════════════════════════════════════════
// Domain / Tunnel
// ═══════════════════════════════════════════════════════════

func (a *API) tunnelURL(w http.ResponseWriter, r *http.Request) {
	// Try reading from data/tunnel-url.txt first (set by external watcher)
	urlFile := filepath.Join(a.cfg.DataDir, "tunnel-url.txt")
	if data, err := os.ReadFile(urlFile); err == nil {
		url := strings.TrimSpace(string(data))
		if url != "" {
			jsonResponse(w, 200, M{"url": url, "active": true})
			return
		}
	}

	// Try journalctl
	if out, err := runCmd([]string{"journalctl", "-u", "cloudflared-tunnel", "--no-pager", "-n", "20", "--output=cat"}, "", 5*time.Second); err == nil {
		for _, line := range strings.Split(out, "\n") {
			if idx := strings.Index(line, "https://"); idx >= 0 {
				url := line[idx:]
				if strings.Contains(url, "trycloudflare.com") {
					if sp := strings.IndexAny(url, " \t\n"); sp >= 0 {
						url = url[:sp]
					}
					jsonResponse(w, 200, M{"url": url, "active": true})
					return
				}
			}
		}
	}

	jsonResponse(w, 200, M{"url": "", "active": false})
}

func (a *API) getDomain(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, 200, M{
		"domain": a.cfg.Domain,
		"tunnel": envStr("TUNNEL", "") == "true",
	})
}

func (a *API) setDomain(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	domain, _ := body["domain"].(string)

	// Update .env file
	envPath := filepath.Join(a.cfg.RootDir, ".env")
	envData, _ := os.ReadFile(envPath)
	lines := strings.Split(string(envData), "\n")

	found := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "DOMAIN=") || trimmed == "# DOMAIN=your.domain.com" {
			if domain != "" {
				lines[i] = "DOMAIN=" + domain
			} else {
				lines[i] = "# DOMAIN=your.domain.com"
			}
			found = true
			break
		}
	}
	if !found && domain != "" {
		lines = append(lines, "DOMAIN="+domain)
	}

	os.WriteFile(envPath, []byte(strings.Join(lines, "\n")), 0600)
	jsonResponse(w, 200, M{"ok": true, "restartRequired": true})
}

// --- Helpers ---

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
