package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ─── i18n Translation Map ────────────────────────────────────────────────────

var notifyMessages = map[string]map[string]string{
	"stop":           {"en": "Response complete", "ko": "응답 완료"},
	"done":           {"en": "Done", "ko": "완료"},
	"error":          {"en": "Error occurred", "ko": "오류 발생"},
	"timeout":        {"en": "Timed out", "ko": "시간 초과"},
	"bash_prefix":    {"en": "Bash: ", "ko": "Bash: "},
	"bash_fallback":  {"en": "Command executed", "ko": "명령 실행됨"},
	"edited":         {"en": "Edited ", "ko": "편집: "},
	"wrote":          {"en": "Wrote ", "ko": "작성: "},
	"read_file":      {"en": "Read ", "ko": "읽기: "},
	"file_edited":    {"en": "File edited", "ko": "파일 편집됨"},
	"file_written":   {"en": "File written", "ko": "파일 작성됨"},
	"file_read":      {"en": "File read", "ko": "파일 읽기"},
	"search_prefix":  {"en": "Search: ", "ko": "검색: "},
	"file_search":    {"en": "File search", "ko": "파일 검색"},
	"grep_prefix":    {"en": "Grep: ", "ko": "Grep: "},
	"content_search": {"en": "Content search", "ko": "내용 검색"},
	"agent_task":     {"en": "Agent task completed", "ko": "에이전트 작업 완료"},
	"web_fetch":      {"en": "Web fetch completed", "ko": "웹 페치 완료"},
	"web_search":     {"en": "Web search", "ko": "웹 검색"},
	"tool_suffix":    {"en": " completed", "ko": " 완료"},
	"tool_fallback":  {"en": "Tool executed", "ko": "도구 실행됨"},
	"waiting":        {"en": "Claude is waiting for your input", "ko": "Claude가 입력을 기다리고 있습니다"},
}

func ntMsg(key, lang string) string {
	if m, ok := notifyMessages[key]; ok {
		if v, ok := m[lang]; ok {
			return v
		}
		return m["en"]
	}
	return key
}

// ─── Settings Language ───────────────────────────────────────────────────────

// ReadSettingsLanguage reads general.language from settings.json.
func ReadSettingsLanguage(settingsFile string) string {
	data, err := os.ReadFile(settingsFile)
	if err != nil {
		return "ko"
	}
	var s struct {
		General struct {
			Language string `json:"language"`
		} `json:"general"`
	}
	if json.Unmarshal(data, &s) != nil || s.General.Language == "" {
		return "ko"
	}
	return s.General.Language
}

// ─── Notification Parsing ────────────────────────────────────────────────────

// Events worth sending a push for (others are intermediate tool calls).
var pushWorthyEvents = map[string]bool{
	"Stop":         true,
	"Notification": true,
}

// ParsedNotification is the result of parsing a raw notification JSON file.
type ParsedNotification struct {
	Session   string
	Window    string
	Event     string
	Message   string
	Ts        int64
	PushWorthy bool
}

// ParseNotifyJSON parses raw notification JSON and formats the message.
// Handles both new format (event+tool+tool_input) and old format (message only).
func ParseNotifyJSON(data []byte, lang string) (ParsedNotification, bool) {
	var raw map[string]any
	if json.Unmarshal(data, &raw) != nil {
		return ParsedNotification{}, false
	}

	p := ParsedNotification{
		Ts: int64(jsonFloat(raw, "ts")),
	}
	p.Session, _ = raw["session"].(string)
	p.Window, _ = raw["window"].(string)

	if evt, ok := raw["event"].(string); ok && evt != "" {
		// New format: raw event data → format server-side
		p.Event = evt
		tool, _ := raw["tool"].(string)
		toolInput, _ := raw["tool_input"].(map[string]any)
		rawMsg, _ := raw["raw_message"].(string)
		p.Message = formatNotification(evt, tool, toolInput, rawMsg, lang)
		// "waiting for input" is redundant after Stop — suppress push & toast
		if evt == "Notification" && (rawMsg == "Claude is waiting for your input" || rawMsg == "") {
			p.PushWorthy = false
		} else {
			p.PushWorthy = pushWorthyEvents[evt]
		}
	} else {
		// Old format: pre-formatted message from Python hook
		p.Message, _ = raw["message"].(string)
		if p.Message == "" {
			p.Message = ntMsg("done", lang)
		}
		oldPushWorthy := map[string]bool{
			"Response complete": true, "response_complete": true,
			"done": true, "error": true, "timeout": true,
		}
		p.PushWorthy = oldPushWorthy[p.Message]
	}

	return p, true
}

func jsonFloat(m map[string]any, key string) float64 {
	v, _ := m[key].(float64)
	return v
}

// Known English messages from Claude Code → i18n key mapping.
var knownMessages = map[string]string{
	"Claude is waiting for your input": "waiting",
	"Response complete":                "stop",
	"Done":                             "done",
	"Error occurred":                   "error",
	"Timed out":                        "timeout",
}

// ─── Notification Formatting ─────────────────────────────────────────────────

func formatNotification(event, tool string, toolInput map[string]any, rawMessage, lang string) string {
	switch event {
	case "Stop":
		return ntMsg("stop", lang)
	case "Notification":
		if rawMessage != "" {
			if key, ok := knownMessages[rawMessage]; ok {
				return ntMsg(key, lang)
			}
			return rawMessage
		}
		return ntMsg("waiting", lang)
	case "PostToolUse":
		return formatToolMessage(tool, toolInput, lang)
	default:
		if rawMessage != "" {
			return rawMessage
		}
		return ntMsg("done", lang)
	}
}

func formatToolMessage(tool string, toolInput map[string]any, lang string) string {
	switch tool {
	case "Bash":
		cmd, _ := toolInput["command"].(string)
		if cmd != "" {
			if len(cmd) > 60 {
				cmd = cmd[:57] + "..."
			}
			return ntMsg("bash_prefix", lang) + cmd
		}
		return ntMsg("bash_fallback", lang)
	case "Edit":
		return fileMsg(toolInput, "edited", "file_edited", lang)
	case "Write":
		return fileMsg(toolInput, "wrote", "file_written", lang)
	case "Read":
		return fileMsg(toolInput, "read_file", "file_read", lang)
	case "Glob":
		return patternMsg(toolInput, "pattern", 0, "search_prefix", "file_search", lang)
	case "Grep":
		return patternMsg(toolInput, "pattern", 40, "grep_prefix", "content_search", lang)
	case "Task", "Agent":
		return ntMsg("agent_task", lang)
	case "WebFetch":
		return ntMsg("web_fetch", lang)
	case "WebSearch":
		return patternMsg(toolInput, "query", 40, "search_prefix", "web_search", lang)
	default:
		if tool != "" {
			return tool + ntMsg("tool_suffix", lang)
		}
		return ntMsg("tool_fallback", lang)
	}
}

// fileMsg formats a file-based tool message (Edit/Write/Read).
func fileMsg(toolInput map[string]any, prefixKey, fallbackKey, lang string) string {
	fp, _ := toolInput["file_path"].(string)
	if fp != "" {
		return ntMsg(prefixKey, lang) + filepath.Base(fp)
	}
	return ntMsg(fallbackKey, lang)
}

// patternMsg formats a pattern/query-based tool message (Glob/Grep/WebSearch).
func patternMsg(toolInput map[string]any, field string, maxLen int, prefixKey, fallbackKey, lang string) string {
	pat, _ := toolInput[field].(string)
	if pat != "" {
		if maxLen > 0 && len(pat) > maxLen {
			pat = pat[:maxLen-3] + "..."
		}
		return ntMsg(prefixKey, lang) + pat
	}
	return ntMsg(fallbackKey, lang)
}
