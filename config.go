package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

const (
	CookieName      = "__claude_session"
	PBKDF2Iterations = 600_000
	DefaultPort      = 7680
)

type Config struct {
	Host     string
	Port     int
	Domain   string
	Password string

	DataDir    string
	PublicDir  string
	NotesDir   string
	UploadDir  string
	NotifyDir  string
	SettingsFile string

	TmuxSocket  string
	TmuxSession string
	ClaudeCmd   string

	PasswordSalt string
	PasswordHash string
	CookieName   string
	SessionMaxAge int
	RateLimitMax  int
	RateLimitWindow int

	RootDir string
	HomeDir string
}

func LoadConfig(flagPort int, flagPassword string) *Config {
	rootDir, _ := os.Getwd()
	homeDir, _ := os.UserHomeDir()

	// Load .env file
	loadDotenv(filepath.Join(rootDir, ".env"))

	cfg := &Config{
		Host:            envStr("HOST", "0.0.0.0"),
		Port:            envInt("PORT", DefaultPort),
		Domain:          envStr("DOMAIN", ""),
		Password:        envStr("PASSWORD", ""),
		DataDir:         filepath.Join(rootDir, "data"),
		PublicDir:       filepath.Join(rootDir, "public"),
		UploadDir:       envStr("UPLOAD_DIR", "/tmp/claude-uploads"),
		NotifyDir:       envStr("NOTIFY_DIR", "/tmp/claude-notify"),
		TmuxSession:     envStr("TMUX_SESSION", "claude"),
		ClaudeCmd:       envStr("CLAUDE_CMD", "claude --dangerously-skip-permissions"),
		CookieName:      CookieName,
		SessionMaxAge:   envInt("SESSION_MAX_AGE", 86400),
		RateLimitMax:    envInt("RATE_LIMIT_MAX", 5),
		RateLimitWindow: envInt("RATE_LIMIT_WINDOW", 900),
		RootDir:         rootDir,
		HomeDir:         homeDir,
	}

	cfg.NotesDir = filepath.Join(cfg.DataDir, "notes")
	cfg.SettingsFile = filepath.Join(cfg.DataDir, "settings.json")

	// CLI flags override env
	if flagPort > 0 {
		cfg.Port = flagPort
	}
	if flagPassword != "" {
		cfg.Password = flagPassword
	}

	// Find tmux socket
	cfg.TmuxSocket = findTmuxSocket()

	// Ensure password hash
	cfg.ensurePasswordHash()

	return cfg
}

func (c *Config) ensurePasswordHash() {
	hashFile := filepath.Join(c.DataDir, ".password_hash")
	os.MkdirAll(c.DataDir, 0755)

	// Try loading existing hash
	if data, err := os.ReadFile(hashFile); err == nil {
		parts := strings.SplitN(strings.TrimSpace(string(data)), ":", 2)
		if len(parts) == 2 {
			c.PasswordSalt = parts[0]
			c.PasswordHash = parts[1]
			return
		}
	}

	// Need password to create hash
	if c.Password == "" || c.Password == "changeme" {
		log.Fatal("ERROR: Set PASSWORD in .env file or --password flag (must not be \"changeme\")")
	}

	// Generate salt and hash
	saltBytes := make([]byte, 32)
	rand.Read(saltBytes)
	c.PasswordSalt = hex.EncodeToString(saltBytes)
	c.PasswordHash = hashPassword(c.Password, c.PasswordSalt)

	// Save to file
	content := fmt.Sprintf("%s:%s", c.PasswordSalt, c.PasswordHash)
	os.WriteFile(hashFile, []byte(content), 0600)
}

func hashPassword(password, saltHex string) string {
	salt, _ := hex.DecodeString(saltHex)
	dk := pbkdf2.Key([]byte(password), salt, PBKDF2Iterations, 32, sha256.New)
	return hex.EncodeToString(dk)
}

func findTmuxSocket() string {
	if custom := envStr("TMUX_SOCKET", ""); custom != "" {
		return custom
	}
	uid := os.Getuid()
	def := fmt.Sprintf("/tmp/tmux-%d/default", uid)
	return def
}

// --- .env loading ---

func loadDotenv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)

		// Remove surrounding quotes
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[0] == value[len(value)-1] {
			value = value[1 : len(value)-1]
		}

		// Only set if not already in env
		if key != "" && os.Getenv(key) == "" {
			os.Setenv(key, value)
		}
	}
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
