package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

type Session struct {
	Created    time.Time
	LastActive time.Time
	IP         string
}

type RateInfo struct {
	Count        int
	FirstAttempt time.Time
}

type Auth struct {
	cfg      *Config
	sessions map[string]*Session
	attempts map[string]*RateInfo
	mu       sync.RWMutex
}

func NewAuth(cfg *Config) *Auth {
	return &Auth{
		cfg:      cfg,
		sessions: make(map[string]*Session),
		attempts: make(map[string]*RateInfo),
	}
}

func (a *Auth) VerifyPassword(password string) bool {
	testHash := hashPassword(password, a.cfg.PasswordSalt)
	return subtle.ConstantTimeCompare([]byte(testHash), []byte(a.cfg.PasswordHash)) == 1
}

func (a *Auth) CreateSession(ip string) string {
	tokenBytes := make([]byte, 32)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	a.mu.Lock()
	defer a.mu.Unlock()
	a.sessions[token] = &Session{
		Created:    time.Now(),
		LastActive: time.Now(),
		IP:         ip,
	}
	return token
}

func (a *Auth) ValidateSession(token string) bool {
	if token == "" {
		return false
	}
	a.mu.RLock()
	session, ok := a.sessions[token]
	a.mu.RUnlock()
	if !ok {
		return false
	}

	if time.Since(session.Created) > time.Duration(a.cfg.SessionMaxAge)*time.Second {
		a.mu.Lock()
		delete(a.sessions, token)
		a.mu.Unlock()
		return false
	}

	a.mu.Lock()
	session.LastActive = time.Now()
	a.mu.Unlock()
	return true
}

func (a *Auth) DestroySession(token string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.sessions, token)
}

func (a *Auth) CleanupSessions() {
	a.mu.Lock()
	defer a.mu.Unlock()
	maxAge := time.Duration(a.cfg.SessionMaxAge) * time.Second
	for token, session := range a.sessions {
		if time.Since(session.Created) > maxAge {
			delete(a.sessions, token)
		}
	}
}

func (a *Auth) CheckRateLimit(ip string) bool {
	a.mu.RLock()
	info, ok := a.attempts[ip]
	a.mu.RUnlock()
	if !ok {
		return true
	}
	window := time.Duration(a.cfg.RateLimitWindow) * time.Second
	if time.Since(info.FirstAttempt) > window {
		a.mu.Lock()
		delete(a.attempts, ip)
		a.mu.Unlock()
		return true
	}
	return info.Count < a.cfg.RateLimitMax
}

func (a *Auth) RecordFailedAttempt(ip string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	window := time.Duration(a.cfg.RateLimitWindow) * time.Second
	info, ok := a.attempts[ip]
	if !ok || time.Since(info.FirstAttempt) > window {
		a.attempts[ip] = &RateInfo{Count: 1, FirstAttempt: time.Now()}
	} else {
		info.Count++
	}
}

func (a *Auth) ResetAttempts(ip string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.attempts, ip)
}

// RequireAuth is middleware that checks session authentication
func (a *Auth) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := getSessionToken(r, a.cfg.CookieName)
		if !a.ValidateSession(token) {
			jsonResponse(w, 401, M{"error": "Unauthorized"})
			return
		}
		next(w, r)
	}
}

func getClientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
			return trimSpace(realIP)
		}
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			parts := splitFirst(forwarded, ",")
			return trimSpace(parts)
		}
	}
	host := r.RemoteAddr
	if idx := lastIndex(host, ":"); idx >= 0 {
		host = host[:idx]
	}
	return host
}

func splitFirst(s, sep string) string {
	for i := 0; i < len(s); i++ {
		if string(s[i]) == sep {
			return s[:i]
		}
	}
	return s
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func lastIndex(s, sep string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if string(s[i]) == sep {
			return i
		}
	}
	return -1
}
