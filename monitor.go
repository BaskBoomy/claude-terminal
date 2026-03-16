package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// MonitorSession represents a claude-loop tmux session
type MonitorSession struct {
	Name      string       `json:"name"`
	Dir       string       `json:"dir"`
	Status    string       `json:"status"` // running | stopped | completed
	Iteration int          `json:"iteration"`
	Tasks     MonitorTasks `json:"tasks"`
	StartTime string       `json:"startTime"`
	Elapsed   int64        `json:"elapsed"` // seconds
}

type MonitorTasks struct {
	Done     int `json:"done"`
	Progress int `json:"progress"`
	Todo     int `json:"todo"`
}

type MonitorDetail struct {
	Name         string       `json:"name"`
	Dir          string       `json:"dir"`
	Status       string       `json:"status"`
	Iteration    int          `json:"iteration"`
	Tasks        MonitorTasks `json:"tasks"`
	TasksContent string       `json:"tasksContent"`
	LatestLog    string       `json:"latestLog"`
	Learnings    string       `json:"learnings"`
	Feedback     string       `json:"feedback"`
	Progress     string       `json:"progress"`
	RollbackTag  string       `json:"rollbackTag"`
	StartTime    string       `json:"startTime"`
	Elapsed      int64        `json:"elapsed"`
	HasReport    bool         `json:"hasReport"`
}

// sessionNameRe validates session names (cl-xxx)
var sessionNameRe = regexp.MustCompile(`^cl-[\w.-]+$`)

// listClaudLoopSessions finds tmux sessions starting with "cl-"
func (a *API) listClaudLoopSessions() []MonitorSession {
	out, err := a.tmux("list-sessions", "-F", "#{session_name}")
	if err != nil {
		return nil
	}

	var sessions []MonitorSession
	for _, name := range strings.Split(strings.TrimSpace(out), "\n") {
		name = strings.TrimSpace(name)
		if name == "" || !strings.HasPrefix(name, "cl-") {
			continue
		}

		sess := MonitorSession{
			Name:   name,
			Status: "running",
		}

		// Get pane cwd
		dirOut, err := a.tmux("display-message", "-p", "-t", name, "#{pane_current_path}")
		if err == nil {
			sess.Dir = strings.TrimSpace(dirOut)
		}

		// Parse TASKS.md if available (resolve worktree if exists)
		if sess.Dir != "" {
			sess.Dir = resolveLoopDir(sess.Dir)
			sess.Tasks = parseTasks(sess.Dir)
			sess.Iteration = detectIteration(sess.Dir)
			sess.StartTime, sess.Elapsed = detectTiming(sess.Dir)

			// Check completion
			if sess.Tasks.Todo == 0 && sess.Tasks.Done > 0 {
				sess.Status = "completed"
			}
		}

		// Determine status: check pane command + recent activity
		cmdOut, err := a.tmux("display-message", "-p", "-t", name, "#{pane_current_command}")
		if err == nil {
			cmd := strings.TrimSpace(cmdOut)
			if cmd == "bash" || cmd == "zsh" || cmd == "sh" || cmd == "" {
				if sess.Status != "completed" && isLoopRecentlyActive(sess.Dir) {
					// Shell idle but loop was active recently — still running (between iterations)
					sess.Status = "running"
				} else if sess.Status != "completed" {
					sess.Status = "stopped"
				}
			}
		}

		sessions = append(sessions, sess)
	}

	if sessions == nil {
		sessions = []MonitorSession{}
	}
	return sessions
}

// isLoopRecentlyActive checks if the loop has recent activity (iteration logs or TASKS.md changes within 10 minutes)
func isLoopRecentlyActive(dir string) bool {
	if dir == "" {
		return false
	}
	threshold := time.Now().Add(-10 * time.Minute)

	// Check TASKS.md modification time
	if info, err := os.Stat(filepath.Join(dir, "TASKS.md")); err == nil {
		if info.ModTime().After(threshold) {
			return true
		}
	}

	// Check .claude-loop-logs/ for recent iteration dirs
	logsDir := filepath.Join(dir, ".claude-loop-logs")
	entries, err := os.ReadDir(logsDir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if info, err := e.Info(); err == nil {
			if info.ModTime().After(threshold) {
				return true
			}
		}
	}
	return false
}

// resolveLoopDir finds the actual working directory (may be a worktree)
func resolveLoopDir(dir string) string {
	// Check if .worktrees/ exists and has subdirectories
	worktreeBase := filepath.Join(dir, ".worktrees")
	entries, err := os.ReadDir(worktreeBase)
	if err != nil {
		return dir
	}
	// Find the most recently modified worktree
	var bestDir string
	var bestTime time.Time
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		wtDir := filepath.Join(worktreeBase, e.Name())
		// Check if this worktree has TASKS.md
		info, err := os.Stat(filepath.Join(wtDir, "TASKS.md"))
		if err != nil {
			continue
		}
		if info.ModTime().After(bestTime) {
			bestTime = info.ModTime()
			bestDir = wtDir
		}
	}
	if bestDir != "" {
		return bestDir
	}
	return dir
}

// parseTasks reads TASKS.md and counts done/progress/todo
func parseTasks(dir string) MonitorTasks {
	data, err := os.ReadFile(filepath.Join(dir, "TASKS.md"))
	if err != nil {
		return MonitorTasks{}
	}

	var done, progress, todo int
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		// claude-loop format: □ (todo), [✓ (done), [→ (progress), ■ (done alt)
		if strings.Contains(trimmed, "[✓") || strings.Contains(trimmed, "■") {
			done++
		} else if strings.Contains(trimmed, "[→") {
			progress++
		} else if strings.Contains(trimmed, "□") {
			todo++
		}
	}
	return MonitorTasks{Done: done, Progress: progress, Todo: todo}
}

// detectIteration finds the current iteration from log files
func detectIteration(dir string) int {
	logDir := filepath.Join(dir, ".claude-loop-logs")
	entries, err := os.ReadDir(logDir)
	if err != nil {
		return 0
	}
	maxIter := 0
	for _, e := range entries {
		name := e.Name()
		// Log files are typically named like iteration-001.log
		if strings.HasSuffix(name, ".log") {
			// Try to extract iteration number
			parts := strings.Split(strings.TrimSuffix(name, ".log"), "-")
			for _, p := range parts {
				if n, err := strconv.Atoi(p); err == nil && n > maxIter {
					maxIter = n
				}
			}
		}
	}
	return maxIter
}

// detectTiming gets start time from log directory or git tag
func detectTiming(dir string) (string, int64) {
	logDir := filepath.Join(dir, ".claude-loop-logs")
	info, err := os.Stat(logDir)
	if err != nil {
		return "", 0
	}
	startTime := info.ModTime()
	elapsed := int64(time.Since(startTime).Seconds())
	return startTime.Format(time.RFC3339), elapsed
}

// getLatestLog reads the last 30 lines of the most recent log file
func getLatestLog(dir string) string {
	logDir := filepath.Join(dir, ".claude-loop-logs")
	entries, err := os.ReadDir(logDir)
	if err != nil {
		return ""
	}

	// Find the latest log file
	var latestFile string
	var latestTime time.Time
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".log") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(latestTime) {
			latestTime = info.ModTime()
			latestFile = e.Name()
		}
	}

	if latestFile == "" {
		return ""
	}

	data, err := os.ReadFile(filepath.Join(logDir, latestFile))
	if err != nil {
		return ""
	}

	lines := strings.Split(string(data), "\n")
	start := len(lines) - 30
	if start < 0 {
		start = 0
	}
	return strings.Join(lines[start:], "\n")
}

// detectRollbackTag finds the claude-loop start tag
func detectRollbackTag(dir string) string {
	out, err := runCmd([]string{"git", "tag", "-l", "claude-loop/start-*", "--sort=-creatordate"}, dir, 3*time.Second)
	if err != nil {
		return ""
	}
	tags := strings.Split(strings.TrimSpace(out), "\n")
	if len(tags) > 0 && tags[0] != "" {
		return tags[0]
	}
	return ""
}

func readFileSafe(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

// --- API Handlers ---

func (a *API) monitorList(w http.ResponseWriter, r *http.Request) {
	sessions := a.listClaudLoopSessions()
	jsonResponse(w, 200, M{"sessions": sessions})
}

func (a *API) monitorDetail(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !sessionNameRe.MatchString(name) {
		jsonResponse(w, 400, M{"error": "Invalid session name"})
		return
	}

	// Get session dir
	dirOut, err := a.tmux("display-message", "-p", "-t", name, "#{pane_current_path}")
	if err != nil {
		jsonResponse(w, 404, M{"error": "Session not found"})
		return
	}
	dir := resolveLoopDir(strings.TrimSpace(dirOut))

	// Check status
	status := "running"
	cmdOut, err := a.tmux("display-message", "-p", "-t", name, "#{pane_current_command}")
	if err == nil {
		cmd := strings.TrimSpace(cmdOut)
		if cmd == "bash" || cmd == "zsh" || cmd == "sh" || cmd == "" {
			status = "stopped"
		}
	}

	tasks := parseTasks(dir)
	if tasks.Todo == 0 && tasks.Done > 0 {
		status = "completed"
	}

	startTime, elapsed := detectTiming(dir)

	// Check if report exists
	reportPath := filepath.Join(dir, ".claude-loop-logs", "report.html")
	_, reportErr := os.Stat(reportPath)

	detail := MonitorDetail{
		Name:         name,
		Dir:          dir,
		Status:       status,
		Iteration:    detectIteration(dir),
		Tasks:        tasks,
		TasksContent: readFileSafe(filepath.Join(dir, "TASKS.md")),
		LatestLog:    getLatestLog(dir),
		Learnings:    readFileSafe(filepath.Join(dir, "LEARNINGS.md")),
		Feedback:     readFileSafe(filepath.Join(dir, "FEEDBACK.md")),
		Progress:     readFileSafe(filepath.Join(dir, ".claude-loop-logs", "progress.md")),
		RollbackTag:  detectRollbackTag(dir),
		StartTime:    startTime,
		Elapsed:      elapsed,
		HasReport:    reportErr == nil,
	}

	jsonResponse(w, 200, detail)
}

func (a *API) monitorSaveFeedback(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !sessionNameRe.MatchString(name) {
		jsonResponse(w, 400, M{"error": "Invalid session name"})
		return
	}

	// Read body
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		jsonResponse(w, 400, M{"error": "Failed to read body"})
		return
	}
	var data M
	if err := json.Unmarshal(body, &data); err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}

	content, _ := data["content"].(string)

	// Get session dir
	dirOut, err := a.tmux("display-message", "-p", "-t", name, "#{pane_current_path}")
	if err != nil {
		jsonResponse(w, 404, M{"error": "Session not found"})
		return
	}
	dir := resolveLoopDir(strings.TrimSpace(dirOut))

	// Write FEEDBACK.md
	feedbackPath := filepath.Join(dir, "FEEDBACK.md")
	if err := os.WriteFile(feedbackPath, []byte(content), 0644); err != nil {
		jsonResponse(w, 500, M{"error": "Failed to write feedback"})
		return
	}

	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) monitorReport(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !sessionNameRe.MatchString(name) {
		http.Error(w, "Invalid session name", 400)
		return
	}

	dirOut, err := a.tmux("display-message", "-p", "-t", name, "#{pane_current_path}")
	if err != nil {
		http.Error(w, "Session not found", 404)
		return
	}
	dir := resolveLoopDir(strings.TrimSpace(dirOut))

	reportPath := filepath.Join(dir, ".claude-loop-logs", "report.html")
	data, err := os.ReadFile(reportPath)
	if err != nil {
		http.Error(w, "Report not found", 404)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

func (a *API) monitorStop(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !sessionNameRe.MatchString(name) {
		jsonResponse(w, 400, M{"error": "Invalid session name"})
		return
	}

	// Send Ctrl-C to the session
	cmd := exec.Command(a.cfg.TmuxBin, "-S", a.cfg.TmuxSocket, "send-keys", "-t", name, "C-c", "")
	if err := cmd.Run(); err != nil {
		jsonResponse(w, 500, M{"error": "Failed to stop session"})
		return
	}

	jsonResponse(w, 200, M{"ok": true})
}
