package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	webpush "github.com/SherClockHolmes/webpush-go"
)

// PushSubscription mirrors the browser PushSubscription object.
type PushSubscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// PushManager handles VAPID keys and push subscriptions.
type PushManager struct {
	mu            sync.RWMutex
	dataDir       string
	settingsFile  string
	subscriptions []PushSubscription
	vapidPrivate  *ecdsa.PrivateKey
	vapidPublicB64 string
	vapidSubject  string
	lastPushMsg   string
	lastPushTime  time.Time
}

func NewPushManager(dataDir, settingsFile string) *PushManager {
	pm := &PushManager{
		dataDir:      dataDir,
		settingsFile: settingsFile,
		vapidSubject: envStr("VAPID_SUBJECT", "https://example.com"),
	}
	pm.loadOrGenerateVAPIDKeys()
	pm.loadSubscriptions()
	return pm
}

// ─── VAPID Key Management ────────────────────────────────────────────────────

func (pm *PushManager) loadOrGenerateVAPIDKeys() {
	keyFile := filepath.Join(pm.dataDir, ".vapid_private.pem")

	// Try loading existing key
	if data, err := os.ReadFile(keyFile); err == nil {
		block, _ := pem.Decode(data)
		if block != nil {
			key, err := x509.ParseECPrivateKey(block.Bytes)
			if err == nil {
				pm.vapidPrivate = key
				pm.vapidPublicB64 = vapidPublicKeyBase64(key)
				log.Printf("[push] VAPID keys loaded from %s", keyFile)
				return
			}
		}
	}

	// Generate new key pair
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Printf("[push] failed to generate VAPID key: %v", err)
		return
	}
	pm.vapidPrivate = key
	pm.vapidPublicB64 = vapidPublicKeyBase64(key)

	// Save private key
	os.MkdirAll(pm.dataDir, 0755)
	der, _ := x509.MarshalECPrivateKey(key)
	pemBlock := &pem.Block{Type: "EC PRIVATE KEY", Bytes: der}
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(pemBlock), 0600); err != nil {
		log.Printf("[push] failed to save VAPID key: %v", err)
	} else {
		log.Printf("[push] VAPID keys generated and saved to %s", keyFile)
	}
}

func vapidPublicKeyBase64(key *ecdsa.PrivateKey) string {
	pub := key.PublicKey
	// Uncompressed point: 0x04 || X || Y (65 bytes)
	bytes := elliptic.Marshal(pub.Curve, pub.X, pub.Y)
	return base64.RawURLEncoding.EncodeToString(bytes)
}

// ─── Subscription Management ─────────────────────────────────────────────────

func (pm *PushManager) subsFile() string {
	return filepath.Join(pm.dataDir, "push-subscriptions.json")
}

func (pm *PushManager) loadSubscriptions() {
	data, err := os.ReadFile(pm.subsFile())
	if err != nil {
		return
	}
	json.Unmarshal(data, &pm.subscriptions)
}

func (pm *PushManager) saveSubscriptions() {
	data, _ := json.MarshalIndent(pm.subscriptions, "", "  ")
	os.WriteFile(pm.subsFile(), data, 0600)
}

func (pm *PushManager) AddSubscription(sub PushSubscription) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Deduplicate by endpoint
	for i, existing := range pm.subscriptions {
		if existing.Endpoint == sub.Endpoint {
			pm.subscriptions[i] = sub
			pm.saveSubscriptions()
			return
		}
	}
	pm.subscriptions = append(pm.subscriptions, sub)
	pm.saveSubscriptions()
}

func (pm *PushManager) RemoveSubscription(endpoint string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	for i, sub := range pm.subscriptions {
		if sub.Endpoint == endpoint {
			pm.subscriptions = append(pm.subscriptions[:i], pm.subscriptions[i+1:]...)
			pm.saveSubscriptions()
			return
		}
	}
}

// ─── Send Push Notification ──────────────────────────────────────────────────

func (pm *PushManager) SendPush(title, body string, ts int64) {
	if pm.vapidPrivate == nil {
		return
	}

	// Dedup: suppress identical push within 5 seconds
	pm.mu.Lock()
	if body == pm.lastPushMsg && time.Since(pm.lastPushTime) < 5*time.Second {
		pm.mu.Unlock()
		log.Printf("[push] dedup suppressed: %s", body)
		return
	}
	pm.lastPushMsg = body
	pm.lastPushTime = time.Now()
	pm.mu.Unlock()

	pm.mu.RLock()
	subs := make([]PushSubscription, len(pm.subscriptions))
	copy(subs, pm.subscriptions)
	pm.mu.RUnlock()

	if len(subs) == 0 {
		return
	}

	payload, _ := json.Marshal(M{
		"title":   title,
		"message": body,
		"ts":      ts,
	})

	var staleEndpoints []string

	for _, sub := range subs {
		s := &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys: webpush.Keys{
				P256dh: sub.Keys.P256dh,
				Auth:   sub.Keys.Auth,
			},
		}

		resp, err := webpush.SendNotification(payload, s, &webpush.Options{
			Subscriber:      pm.vapidSubject,
			VAPIDPublicKey:  pm.vapidPublicB64,
			VAPIDPrivateKey: vapidPrivateKeyBase64(pm.vapidPrivate),
			TTL:             60,
		})
		if err != nil {
			log.Printf("[push] send error to %s: %v", truncate(sub.Endpoint, 40), err)
			continue
		}
		resp.Body.Close()

		// 410 Gone or 404 = subscription expired
		if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
			staleEndpoints = append(staleEndpoints, sub.Endpoint)
		}
	}

	// Clean up stale subscriptions
	for _, ep := range staleEndpoints {
		pm.RemoveSubscription(ep)
		log.Printf("[push] removed stale subscription: %s", truncate(ep, 40))
	}
}

func vapidPrivateKeyBase64(key *ecdsa.PrivateKey) string {
	return base64.RawURLEncoding.EncodeToString(key.D.Bytes())
}

// ─── HTTP Handlers ───────────────────────────────────────────────────────────

func (a *API) pushVAPIDKey(w http.ResponseWriter, r *http.Request) {
	if a.push == nil {
		jsonResponse(w, 503, M{"error": "push not available"})
		return
	}
	jsonResponse(w, 200, M{"publicKey": a.push.vapidPublicB64})
}

func (a *API) pushSubscribe(w http.ResponseWriter, r *http.Request) {
	if a.push == nil {
		jsonResponse(w, 503, M{"error": "push not available"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096) // 4KB max for subscription
	var sub PushSubscription
	if err := json.NewDecoder(r.Body).Decode(&sub); err != nil || sub.Endpoint == "" {
		jsonResponse(w, 400, M{"error": "invalid subscription"})
		return
	}
	a.push.AddSubscription(sub)
	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) pushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	if a.push == nil {
		jsonResponse(w, 503, M{"error": "push not available"})
		return
	}
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
		jsonResponse(w, 400, M{"error": "invalid request"})
		return
	}
	a.push.RemoveSubscription(body.Endpoint)
	jsonResponse(w, 200, M{"ok": true})
}

// ─── Test Push (for debugging) ───────────────────────────────────────────────

func (a *API) pushTest(w http.ResponseWriter, r *http.Request) {
	if a.push == nil {
		jsonResponse(w, 503, M{"error": "push not available"})
		return
	}
	count := len(a.push.subscriptions)
	if count == 0 {
		jsonResponse(w, 200, M{"ok": false, "message": "no subscriptions"})
		return
	}
	a.push.SendPush("Claude Terminal", fmt.Sprintf("테스트 알림 (%d 구독)", count), 0)
	jsonResponse(w, 200, M{"ok": true, "subscriptions": count})
}

// ─── File Watcher — push on new notification files ───────────────────────────

func (pm *PushManager) WatchNotifyDir(notifyDir string) {
	os.MkdirAll(notifyDir, 0755)

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("[push] fsnotify init failed: %v", err)
		return
	}

	go func() {
		defer watcher.Close()
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Op&fsnotify.Create != 0 && strings.HasSuffix(event.Name, ".json") {
					body, ts, worthy := pm.parseNotification(event.Name)
					if body == "" || !worthy {
						continue
					}
					log.Printf("[push] sending: %s", body)
					pm.SendPush("Claude Terminal", body, ts)
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("[push] watcher error: %v", err)
			}
		}
	}()

	if err := watcher.Add(notifyDir); err != nil {
		log.Printf("[push] failed to watch %s: %v", notifyDir, err)
	} else {
		log.Printf("[push] watching %s for new notifications", notifyDir)
	}
}

// parseNotification reads a notification file and returns body, ts, and whether it's push-worthy.
func (pm *PushManager) parseNotification(path string) (string, int64, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", 0, false
	}
	lang := ReadSettingsLanguage(pm.settingsFile)
	p, ok := ParseNotifyJSON(data, lang)
	if !ok {
		return "", 0, false
	}
	return p.Message, p.Ts, p.PushWorthy
}
