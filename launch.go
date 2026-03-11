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
		// P0 - 블로커
		{"billing", "빌링/결제", "P0", "토스페이먼츠 실결제 E2E 테스트", 1},
		{"billing", "빌링/결제", "P0", "빌링키 발급 플로우 검증", 1},
		{"billing", "빌링/결제", "P0", "첫 결제 + 구독 ACTIVE 플로우", 1},
		{"billing", "빌링/결제", "P0", "환불/취소 플로우 구현", 2},
		{"billing", "빌링/결제", "P0", "일할계산 구현", 2},
		{"infra", "인프라/배포", "P0", "AWS Lightsail 세팅 + 구성", 1},
		{"infra", "인프라/배포", "P0", "Supabase Pro 마이그레이션", 1},
		{"infra", "인프라/배포", "P0", "CI/CD 파이프라인 (GitHub Actions)", 2},
		{"infra", "인프라/배포", "P0", "무중단 배포 전략 수립", 2},
		{"infra", "인프라/배포", "P0", "프로덕션 도메인 + SSL 인증서", 1},
		{"security", "보안", "P0", "멀티테넌트 데이터 격리 검증", 2},
		{"security", "보안", "P0", "인증/인가 보안 감사", 2},
		{"security", "보안", "P0", "API 레이트 리밋 구현", 2},
		{"legal", "법률/규정", "P0", "개인정보처리방침 작성", 3},
		{"legal", "법률/규정", "P0", "이용약관 작성", 3},
		{"legal", "법률/규정", "P0", "통신판매업 신고", 3},
		{"feature", "기능 완성도", "P0", "미커밋 빌링 코드 커밋", 1},
		{"feature", "기능 완성도", "P0", "pg-boss 스케줄러 코드 커밋", 1},
		{"feature", "기능 완성도", "P0", "Reverse Trial 플로우 검증", 1},
		// P1 - 필수
		{"monitoring", "모니터링/운영", "P1", "에러 트래킹 설정 (Sentry)", 2},
		{"monitoring", "모니터링/운영", "P1", "프로덕션 로깅 전략", 2},
		{"monitoring", "모니터링/운영", "P1", "알림 에스컬레이션 (Discord/이메일)", 2},
		{"monitoring", "모니터링/운영", "P1", "장애 대응 런북 작성", 3},
		{"testing", "테스트", "P1", "부하 테스트 (예상 트래픽 3~5배)", 3},
		{"testing", "테스트", "P1", "크로스 브라우저 테스트", 3},
		{"testing", "테스트", "P1", "모바일 UX 테스트", 3},
		{"testing", "테스트", "P1", "E2E 테스트 (핵심 플로우)", 2},
		{"performance", "성능/확장성", "P1", "DB 쿼리 최적화 + 인덱싱", 2},
		{"performance", "성능/확장성", "P1", "정적 에셋 CDN 설정", 3},
		{"performance", "성능/확장성", "P1", "이미지 최적화 (WebP/lazy)", 3},
		{"dr", "재해 복구", "P1", "DB 백업 자동화", 2},
		{"dr", "재해 복구", "P1", "백업 복원 테스트 (RPO/RTO)", 3},
		{"marketing", "마케팅/온보딩", "P1", "랜딩 페이지 완성", 3},
		{"marketing", "마케팅/온보딩", "P1", "신규 조직 온보딩 위저드", 3},
		{"marketing", "마케팅/온보딩", "P1", "베타 테스터 모집", 2},
		// P2 - 권장
		{"support", "고객 지원", "P2", "FAQ 페이지 작성", 3},
		{"support", "고객 지원", "P2", "지원 채널 구축 (채팅/이메일)", 3},
		{"docs", "사용자 가이드", "P2", "도움말 센터 / 튜토리얼", 3},
		{"docs", "사용자 가이드", "P2", "관리자 가이드 문서", 4},
		{"migration", "데이터 마이그레이션", "P2", "구축형 -> SaaS 마이그레이션 계획", 2},
		{"migration", "데이터 마이그레이션", "P2", "마이그레이션 스크립트 + 검증", 3},
		{"seo", "SEO/랜딩", "P2", "전체 페이지 메타태그 + OG 이미지", 3},
		{"seo", "SEO/랜딩", "P2", "Google Search Console 등록", 4},
		{"analytics", "분석/메트릭", "P2", "GA4 / Mixpanel 연동", 3},
		{"analytics", "분석/메트릭", "P2", "핵심 KPI 대시보드", 4},
		// P3 - 오픈 후 가능
		{"continuity", "비즈니스 연속성", "P3", "SLA 정의 문서", 4},
		{"continuity", "비즈니스 연속성", "P3", "데이터 보존 정책", 4},
		{"feature", "기능 완성도", "P3", "모바일 UX 개선 (회원 관리)", 4},
		{"feature", "기능 완성도", "P3", "외부 장치 연동 (BioStar2)", 4},
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
