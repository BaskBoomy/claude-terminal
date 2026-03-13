package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type TOTP struct {
	secretFile   string
	recoveryFile string
	mu           sync.RWMutex
	secret       []byte // raw secret bytes
	enabled      bool
	recoveryCodes []string
}

func NewTOTP(dataDir string) *TOTP {
	t := &TOTP{
		secretFile:   filepath.Join(dataDir, ".totp_secret"),
		recoveryFile: filepath.Join(dataDir, ".totp_recovery"),
	}
	t.load()
	return t
}

func (t *TOTP) load() {
	data, err := os.ReadFile(t.secretFile)
	if err != nil {
		return
	}
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.TrimSpace(string(data)))
	if err != nil {
		return
	}
	t.secret = secret
	t.enabled = true

	// Load recovery codes
	recData, err := os.ReadFile(t.recoveryFile)
	if err != nil {
		return
	}
	lines := strings.Split(strings.TrimSpace(string(recData)), "\n")
	t.recoveryCodes = nil
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			t.recoveryCodes = append(t.recoveryCodes, line)
		}
	}
}

func (t *TOTP) IsEnabled() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.enabled
}

// GenerateSecret creates a new TOTP secret (does NOT persist yet).
// Returns base32-encoded secret.
func (t *TOTP) GenerateSecret() string {
	secretBytes := make([]byte, 20)
	rand.Read(secretBytes)
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secretBytes)
}

// GenerateRecoveryCodes creates 5 random 8-char alphanumeric codes.
func (t *TOTP) GenerateRecoveryCodes() []string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no ambiguous chars (0/O, 1/I)
	codes := make([]string, 5)
	for i := range codes {
		code := make([]byte, 8)
		for j := range code {
			n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
			code[j] = charset[n.Int64()]
		}
		codes[i] = string(code)
	}
	return codes
}

// OTPAuthURI generates the otpauth:// URI for QR code scanning.
func (t *TOTP) OTPAuthURI(secretB32 string, issuer string) string {
	return fmt.Sprintf("otpauth://totp/%s:admin?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		issuer, secretB32, issuer)
}

// ValidateCode checks if the given 6-digit code is valid for the given base32 secret.
// Checks current time step +/- 1.
func (t *TOTP) ValidateCode(secretB32 string, code string) bool {
	if len(code) != 6 {
		return false
	}
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secretB32)
	if err != nil {
		return false
	}
	now := time.Now().Unix() / 30
	for _, offset := range []int64{-1, 0, 1} {
		expected := generateTOTPCode(secret, now+offset)
		if code == expected {
			return true
		}
	}
	return false
}

// ValidateCurrentCode validates against the stored secret.
func (t *TOTP) ValidateCurrentCode(code string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if !t.enabled || t.secret == nil {
		return false
	}
	secretB32 := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(t.secret)
	return t.ValidateCode(secretB32, code)
}

// UseRecoveryCode checks and consumes a recovery code. Returns true if valid.
func (t *TOTP) UseRecoveryCode(code string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	code = strings.ToUpper(strings.TrimSpace(code))
	for i, stored := range t.recoveryCodes {
		if stored == code {
			// Remove used code
			t.recoveryCodes = append(t.recoveryCodes[:i], t.recoveryCodes[i+1:]...)
			// Persist
			os.WriteFile(t.recoveryFile, []byte(strings.Join(t.recoveryCodes, "\n")), 0600)
			return true
		}
	}
	return false
}

// Enable persists the TOTP secret and recovery codes.
func (t *TOTP) Enable(secretB32 string, recoveryCodes []string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secretB32)
	if err != nil {
		return err
	}
	if err := os.WriteFile(t.secretFile, []byte(secretB32), 0600); err != nil {
		return err
	}
	if err := os.WriteFile(t.recoveryFile, []byte(strings.Join(recoveryCodes, "\n")), 0600); err != nil {
		return err
	}
	t.secret = secret
	t.enabled = true
	t.recoveryCodes = recoveryCodes
	return nil
}

// Disable removes TOTP.
func (t *TOTP) Disable() {
	t.mu.Lock()
	defer t.mu.Unlock()
	os.Remove(t.secretFile)
	os.Remove(t.recoveryFile)
	t.secret = nil
	t.enabled = false
	t.recoveryCodes = nil
}

func generateTOTPCode(secret []byte, counter int64) string {
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(counter))
	mac := hmac.New(sha1.New, secret)
	mac.Write(buf)
	hash := mac.Sum(nil)
	offset := hash[len(hash)-1] & 0x0f
	code := binary.BigEndian.Uint32(hash[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", code%1000000)
}
