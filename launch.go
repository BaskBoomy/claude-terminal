package main

import (
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/google/uuid"
)

// LaunchItem represents a single checklist item
type LaunchItem struct {
	ID          string `json:"id"`
	Area        string `json:"area"`
	AreaLabel   string `json:"areaLabel"`
	Priority    string `json:"priority"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Done        bool   `json:"done"`
	Week        int    `json:"week,omitempty"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
	DoneAt      *int64 `json:"doneAt,omitempty"`
}

type LaunchConfig struct {
	TargetDate string `json:"targetDate"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

type LaunchHistoryEntry struct {
	Type      string `json:"type"`
	Timestamp int64  `json:"timestamp"`
	From      string `json:"from,omitempty"`
	To        string `json:"to,omitempty"`
	Reason    string `json:"reason,omitempty"`
	ItemID    string `json:"itemId,omitempty"`
	Title     string `json:"title,omitempty"`
}

func (a *API) launchDir() string {
	return filepath.Join(a.cfg.DataDir, "launch")
}

func (a *API) loadLaunchConfig() LaunchConfig {
	data, err := os.ReadFile(filepath.Join(a.launchDir(), "config.json"))
	if err != nil {
		now := time.Now().UnixMilli()
		return LaunchConfig{TargetDate: "2026-04-01", CreatedAt: now, UpdatedAt: now}
	}
	var cfg LaunchConfig
	json.Unmarshal(data, &cfg)
	return cfg
}

func (a *API) saveLaunchConfig(cfg LaunchConfig) {
	os.MkdirAll(a.launchDir(), 0755)
	data, _ := json.MarshalIndent(cfg, "", "  ")
	tmp := filepath.Join(a.launchDir(), "config.json.tmp")
	os.WriteFile(tmp, data, 0644)
	os.Rename(tmp, filepath.Join(a.launchDir(), "config.json"))
}

func (a *API) loadLaunchItems() []LaunchItem {
	data, err := os.ReadFile(filepath.Join(a.launchDir(), "items.json"))
	if err != nil {
		return []LaunchItem{}
	}
	var items []LaunchItem
	json.Unmarshal(data, &items)
	return items
}

func (a *API) saveLaunchItems(items []LaunchItem) {
	os.MkdirAll(a.launchDir(), 0755)
	data, _ := json.MarshalIndent(items, "", "  ")
	tmp := filepath.Join(a.launchDir(), "items.json.tmp")
	os.WriteFile(tmp, data, 0644)
	os.Rename(tmp, filepath.Join(a.launchDir(), "items.json"))
}

func (a *API) loadLaunchHistory() []LaunchHistoryEntry {
	data, err := os.ReadFile(filepath.Join(a.launchDir(), "history.json"))
	if err != nil {
		return []LaunchHistoryEntry{}
	}
	var history []LaunchHistoryEntry
	json.Unmarshal(data, &history)
	return history
}

func (a *API) appendLaunchHistory(entry LaunchHistoryEntry) {
	history := a.loadLaunchHistory()
	history = append(history, entry)
	os.MkdirAll(a.launchDir(), 0755)
	data, _ := json.MarshalIndent(history, "", "  ")
	os.WriteFile(filepath.Join(a.launchDir(), "history.json"), data, 0644)
}

// ═══════════════════════════════════════════════════════════
// Launch API Handlers
// ═══════════════════════════════════════════════════════════

func (a *API) launchStatus(w http.ResponseWriter, r *http.Request) {
	cfg := a.loadLaunchConfig()
	items := a.loadLaunchItems()

	total := len(items)
	done := 0
	blockers := 0
	byPriority := map[string][2]int{}

	for _, item := range items {
		p := byPriority[item.Priority]
		p[1]++
		if item.Done {
			done++
			p[0]++
		}
		if !item.Done && item.Priority == "P0" {
			blockers++
		}
		byPriority[item.Priority] = p
	}

	pct := 0
	if total > 0 {
		pct = int(math.Round(float64(done) / float64(total) * 100))
	}

	target, _ := time.Parse("2006-01-02", cfg.TargetDate)
	now := time.Now()
	dday := int(math.Ceil(target.Sub(now).Hours() / 24))

	priorities := []M{}
	for _, p := range []string{"P0", "P1", "P2", "P3"} {
		if counts, ok := byPriority[p]; ok {
			priorities = append(priorities, M{
				"priority": p,
				"done":     counts[0],
				"total":    counts[1],
			})
		}
	}

	jsonResponse(w, 200, M{
		"targetDate": cfg.TargetDate,
		"dday":       dday,
		"total":      total,
		"done":       done,
		"pct":        pct,
		"blockers":   blockers,
		"priorities": priorities,
	})
}

func (a *API) launchGetItems(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, 200, M{"items": a.loadLaunchItems()})
}

func (a *API) launchAddItem(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}
	now := time.Now().UnixMilli()
	area, _ := body["area"].(string)
	areaLabel, _ := body["areaLabel"].(string)
	priority, _ := body["priority"].(string)
	title, _ := body["title"].(string)
	desc, _ := body["description"].(string)

	if title == "" {
		jsonResponse(w, 400, M{"error": "Title required"})
		return
	}

	item := LaunchItem{
		ID:          uuid.New().String()[:8],
		Area:        area,
		AreaLabel:   areaLabel,
		Priority:    priority,
		Title:       title,
		Description: desc,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if w, ok := body["week"].(float64); ok {
		item.Week = int(w)
	}

	items := a.loadLaunchItems()
	items = append(items, item)
	a.saveLaunchItems(items)
	jsonResponse(w, 200, M{"id": item.ID})
}

func (a *API) launchUpdateItem(w http.ResponseWriter, r *http.Request) {
	itemID := r.PathValue("id")
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}

	items := a.loadLaunchItems()
	found := false
	for i := range items {
		if items[i].ID != itemID {
			continue
		}
		found = true
		now := time.Now().UnixMilli()

		if v, ok := body["title"].(string); ok {
			items[i].Title = v
		}
		if v, ok := body["description"].(string); ok {
			items[i].Description = v
		}
		if v, ok := body["priority"].(string); ok {
			items[i].Priority = v
		}
		if v, ok := body["area"].(string); ok {
			items[i].Area = v
		}
		if v, ok := body["areaLabel"].(string); ok {
			items[i].AreaLabel = v
		}
		if v, ok := body["week"].(float64); ok {
			items[i].Week = int(v)
		}
		if done, ok := body["done"].(bool); ok {
			wasDone := items[i].Done
			items[i].Done = done
			if done && !wasDone {
				items[i].DoneAt = &now
				a.appendLaunchHistory(LaunchHistoryEntry{
					Type: "item_done", Timestamp: now,
					ItemID: itemID, Title: items[i].Title,
				})
			} else if !done && wasDone {
				items[i].DoneAt = nil
				a.appendLaunchHistory(LaunchHistoryEntry{
					Type: "item_undone", Timestamp: now,
					ItemID: itemID, Title: items[i].Title,
				})
			}
		}
		items[i].UpdatedAt = now
		break
	}

	if !found {
		jsonResponse(w, 404, M{"error": "Item not found"})
		return
	}
	a.saveLaunchItems(items)
	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) launchDeleteItem(w http.ResponseWriter, r *http.Request) {
	itemID := r.PathValue("id")
	items := a.loadLaunchItems()
	newItems := make([]LaunchItem, 0, len(items))
	found := false
	for _, item := range items {
		if item.ID == itemID {
			found = true
			continue
		}
		newItems = append(newItems, item)
	}
	if !found {
		jsonResponse(w, 404, M{"error": "Item not found"})
		return
	}
	a.saveLaunchItems(newItems)
	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) launchGetConfig(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, 200, a.loadLaunchConfig())
}

func (a *API) launchUpdateConfig(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r)
	if err != nil {
		jsonResponse(w, 400, M{"error": "Invalid JSON"})
		return
	}

	cfg := a.loadLaunchConfig()
	oldDate := cfg.TargetDate

	if targetDate, ok := body["targetDate"].(string); ok {
		if _, err := time.Parse("2006-01-02", targetDate); err != nil {
			jsonResponse(w, 400, M{"error": "Invalid date format (YYYY-MM-DD)"})
			return
		}
		cfg.TargetDate = targetDate
	}
	cfg.UpdatedAt = time.Now().UnixMilli()
	a.saveLaunchConfig(cfg)

	if cfg.TargetDate != oldDate {
		reason, _ := body["reason"].(string)
		a.appendLaunchHistory(LaunchHistoryEntry{
			Type: "date_change", Timestamp: cfg.UpdatedAt,
			From: oldDate, To: cfg.TargetDate, Reason: reason,
		})
	}

	jsonResponse(w, 200, M{"ok": true})
}

func (a *API) launchGetHistory(w http.ResponseWriter, r *http.Request) {
	history := a.loadLaunchHistory()
	sort.Slice(history, func(i, j int) bool {
		return history[i].Timestamp > history[j].Timestamp
	})
	jsonResponse(w, 200, M{"history": history})
}

func (a *API) launchSeed(w http.ResponseWriter, r *http.Request) {
	items := a.loadLaunchItems()
	if len(items) > 0 {
		jsonResponse(w, 200, M{"ok": false, "message": "Items already exist"})
		return
	}

	now := time.Now().UnixMilli()
	type seed struct {
		area, label, priority, title string
		week                         int
	}
	seeds := []seed{
		// P0 - Blockers
		{"billing", "Billing/Payment", "P0", "TossPayments real payment E2E test", 1},
		{"billing", "Billing/Payment", "P0", "Billing key issuance flow", 1},
		{"billing", "Billing/Payment", "P0", "First payment + subscription ACTIVE flow", 1},
		{"billing", "Billing/Payment", "P0", "Refund/cancel flow implementation", 2},
		{"billing", "Billing/Payment", "P0", "Pro-rata billing implementation", 2},
		{"infra", "Infrastructure/Deploy", "P0", "AWS Lightsail setup + configuration", 1},
		{"infra", "Infrastructure/Deploy", "P0", "Supabase Pro migration", 1},
		{"infra", "Infrastructure/Deploy", "P0", "CI/CD pipeline (GitHub Actions)", 2},
		{"infra", "Infrastructure/Deploy", "P0", "Zero-downtime deployment strategy", 2},
		{"infra", "Infrastructure/Deploy", "P0", "Production domain + SSL certificate", 1},
		{"security", "Security", "P0", "Multi-tenant data isolation verification", 2},
		{"security", "Security", "P0", "Auth/authorization security audit", 2},
		{"security", "Security", "P0", "API rate limiting implementation", 2},
		{"legal", "Legal/Compliance", "P0", "Privacy policy draft", 3},
		{"legal", "Legal/Compliance", "P0", "Terms of service draft", 3},
		{"legal", "Legal/Compliance", "P0", "E-commerce registration", 3},
		{"feature", "Feature Completeness", "P0", "Commit all uncommitted billing code", 1},
		{"feature", "Feature Completeness", "P0", "Commit pg-boss scheduler code", 1},
		{"feature", "Feature Completeness", "P0", "Reverse trial flow verification", 1},
		// P1 - Must have
		{"monitoring", "Monitoring/Ops", "P1", "Error tracking setup (Sentry)", 2},
		{"monitoring", "Monitoring/Ops", "P1", "Production logging strategy", 2},
		{"monitoring", "Monitoring/Ops", "P1", "Alert escalation (Discord/email)", 2},
		{"monitoring", "Monitoring/Ops", "P1", "Incident response runbook", 3},
		{"testing", "Testing", "P1", "Load test (3-5x expected traffic)", 3},
		{"testing", "Testing", "P1", "Cross-browser testing", 3},
		{"testing", "Testing", "P1", "Mobile UX testing", 3},
		{"testing", "Testing", "P1", "E2E test for critical paths", 2},
		{"performance", "Performance", "P1", "DB query optimization + indexing", 2},
		{"performance", "Performance", "P1", "CDN setup for static assets", 3},
		{"performance", "Performance", "P1", "Image optimization (WebP/lazy)", 3},
		{"dr", "Disaster Recovery", "P1", "DB backup automation", 2},
		{"dr", "Disaster Recovery", "P1", "Backup restore test (RPO/RTO)", 3},
		{"marketing", "Marketing/Onboarding", "P1", "Landing page finalize", 3},
		{"marketing", "Marketing/Onboarding", "P1", "Onboarding wizard for new orgs", 3},
		{"marketing", "Marketing/Onboarding", "P1", "Beta tester recruitment", 2},
		// P2 - Nice to have
		{"support", "Customer Support", "P2", "FAQ page creation", 3},
		{"support", "Customer Support", "P2", "Support channel setup (chat/email)", 3},
		{"docs", "User Guide/Docs", "P2", "Help center / tutorials", 3},
		{"docs", "User Guide/Docs", "P2", "Admin guide document", 4},
		{"migration", "Data Migration", "P2", "Enterprise -> SaaS migration plan", 2},
		{"migration", "Data Migration", "P2", "Migration script + validation", 3},
		{"seo", "SEO/Landing", "P2", "Meta tags + OG images for all pages", 3},
		{"seo", "SEO/Landing", "P2", "Google Search Console registration", 4},
		{"analytics", "Analytics/Metrics", "P2", "GA4 / Mixpanel integration", 3},
		{"analytics", "Analytics/Metrics", "P2", "Core KPI dashboard", 4},
		// P3 - Post-launch OK
		{"continuity", "Business Continuity", "P3", "SLA definition document", 4},
		{"continuity", "Business Continuity", "P3", "Data retention policy", 4},
		{"feature", "Feature Completeness", "P3", "Mobile UX improvement (member mgmt)", 4},
		{"feature", "Feature Completeness", "P3", "External device integration (BioStar2)", 4},
	}

	newItems := make([]LaunchItem, len(seeds))
	for i, s := range seeds {
		newItems[i] = LaunchItem{
			ID:        uuid.New().String()[:8],
			Area:      s.area,
			AreaLabel: s.label,
			Priority:  s.priority,
			Title:     s.title,
			Week:      s.week,
			CreatedAt: now,
			UpdatedAt: now,
		}
	}

	a.saveLaunchItems(newItems)
	a.saveLaunchConfig(LaunchConfig{
		TargetDate: "2026-04-01",
		CreatedAt:  now,
		UpdatedAt:  now,
	})

	jsonResponse(w, 200, M{"ok": true, "count": len(newItems)})
}
