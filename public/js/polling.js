import { showToast, colorForPct, colorForTemp } from './utils.js';
import { t } from './i18n.js';
import { T } from './theme.js';

// --- State ---
let tmuxPollTimer = null;
let usagePollTimer = null;
let serverPollTimer = null;
let notifyPollTimer = null;

let usageBackoff = 60000;
let lastServerData = null;
let notifySince = Date.now();
let notifyEnabled = false;

window._cachedUsageData = null;

// --- DOM refs (lazy) ---
let tmuxSessionEl, usageEl, serverStatusEl;

function ensureEls() {
    if (!tmuxSessionEl) tmuxSessionEl = document.getElementById('tmux-session-info');
    if (!usageEl) usageEl = document.getElementById('claude-usage-info');
    if (!serverStatusEl) serverStatusEl = document.getElementById('server-status-info');
}

// ========================================
// 1. Tmux Session
// ========================================

export function fetchTmuxSession() {
    ensureEls();
    fetch('/api/tmux-session').then(function(r) {
        return r.ok ? r.json() : null;
    }).then(function(data) {
        if (!data || !data.session) return;
        var raw = data.session; // e.g. "claude:4.npm"
        var parts = raw.split(':');
        var sessionName = parts[0] || raw;
        var winPart = parts.slice(1).join(':');
        if (winPart) {
            var dotIdx = winPart.indexOf('.');
            var winDisplay = dotIdx >= 0
                ? winPart.substring(0, dotIdx) + ':' + winPart.substring(dotIdx + 1)
                : winPart;
            tmuxSessionEl.innerHTML = '<span>' + sessionName + '</span>\u00B7' + winDisplay;
        } else {
            tmuxSessionEl.innerHTML = '<span>' + sessionName + '</span>';
        }
    }).catch(function() {});
}

function startTmuxPolling() {
    if (tmuxPollTimer) return;
    fetchTmuxSession();
    tmuxPollTimer = setInterval(fetchTmuxSession, 2000);
}

function stopTmuxPolling() {
    if (tmuxPollTimer) {
        clearInterval(tmuxPollTimer);
        tmuxPollTimer = null;
    }
}

// ========================================
// 2. Claude Usage
// ========================================

export function fetchClaudeUsage() {
    ensureEls();
    fetch('/api/claude-usage').then(function(r) {
        return r.ok ? r.json() : null;
    }).then(function(data) {
        window._cachedUsageData = data;
        if (!data || data.error || !data.five_hour) {
            usageEl.textContent = '';
            // Back off on error
            if (data && data.error) {
                usageBackoff = Math.min(usageBackoff * 2, 300000); // max 5min
                stopUsagePolling();
                usagePollTimer = setInterval(fetchClaudeUsage, usageBackoff);
            }
            return;
        }
        // Success — reset to normal interval
        if (usageBackoff > 60000) {
            usageBackoff = 60000;
            stopUsagePolling();
            startUsagePolling();
        }
        _renderUsage(data);
    }).catch(function() {
        usageEl.textContent = '';
    });
}

function _renderUsage(data) {
    var pct = Math.round(parseFloat(data.five_hour.utilization) * 100);
    var resetTs = parseInt(data.five_hour.resets_at, 10);
    var resetAt = new Date(resetTs * 1000);
    var diffMs = resetAt - Date.now();
    var timeStr = '';
    if (diffMs > 0) {
        var totalMin = Math.floor(diffMs / 60000);
        var h = Math.floor(totalMin / 60);
        var m = totalMin % 60;
        timeStr = h > 0 ? h + 'h' + m + 'm' : m + 'm';
    } else {
        timeStr = 'soon';
    }
    usageEl.textContent = pct + '%\u00B7' + timeStr;
    if (pct >= 80) {
        usageEl.style.color = T.danger();
    } else if (pct >= 50) {
        usageEl.style.color = T.warn;
    } else {
        usageEl.style.color = T.textSubtle();
    }
}

export function startUsagePolling() {
    if (usagePollTimer) return;
    fetchClaudeUsage();
    usagePollTimer = setInterval(fetchClaudeUsage, 60000);
}

export function stopUsagePolling() {
    if (usagePollTimer) {
        clearInterval(usagePollTimer);
        usagePollTimer = null;
    }
}

export function getCachedUsageData() {
    return window._cachedUsageData;
}

// ========================================
// 3. Server Status
// ========================================

export function fetchServerStatus() {
    ensureEls();
    fetch('/api/server-status').then(function(r) {
        return r.ok ? r.json() : null;
    }).then(function(data) {
        if (!data) { serverStatusEl.textContent = ''; return; }
        lastServerData = data;
        var parts = [];
        if (data.cpu != null) {
            parts.push('<span style="color:' + colorForPct(data.cpu) + '">C' + data.cpu + '</span>');
        }
        if (data.mem != null) {
            parts.push('<span style="color:' + colorForPct(data.mem) + '">M' + data.mem + '</span>');
        }
        if (data.temp != null) {
            parts.push('<span style="color:' + colorForTemp(data.temp) + '">' + data.temp + '\u00B0</span>');
        }
        serverStatusEl.innerHTML = parts.join('\u00B7');
    }).catch(function() {});
}

export function startServerPolling() {
    if (serverPollTimer) return;
    fetchServerStatus();
    serverPollTimer = setInterval(fetchServerStatus, 10000);
}

export function stopServerPolling() {
    if (serverPollTimer) {
        clearInterval(serverPollTimer);
        serverPollTimer = null;
    }
}

export function getLastServerData() {
    return lastServerData;
}

// ========================================
// 4. Notifications
// ========================================

function notifyPoll() {
    fetch('/api/notifications?since=' + notifySince, { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d || !d.notifications || d.notifications.length === 0) return;
            d.notifications.forEach(function(n) {
                if (n.ts > notifySince) notifySince = n.ts;
            });
            var latest = d.notifications[d.notifications.length - 1];
            var body = latest.message || 'Done';
            // Push notifications are handled by SW via Web Push API.
            // Only show in-app toast when the app is in the foreground.
            if (document.visibilityState !== 'hidden') {
                showToast(body, 2000);
            }
        })
        .catch(function() {});
}

export function startNotifyPolling() {
    if (!notifyEnabled || notifyPollTimer) return;
    notifySince = Date.now();
    notifyPoll();
    notifyPollTimer = setInterval(notifyPoll, 3000);
}

export function stopNotifyPolling() {
    if (notifyPollTimer) {
        clearInterval(notifyPollTimer);
        notifyPollTimer = null;
    }
}

export function setNotifyEnabled(enabled) {
    notifyEnabled = enabled;
    if (enabled) {
        startNotifyPolling();
    } else {
        stopNotifyPolling();
    }
}

// ========================================
// Visibility change — pause/resume all
// ========================================

document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
        stopTmuxPolling();
        stopUsagePolling();
        stopServerPolling();
    } else {
        startTmuxPolling();
        startUsagePolling();
        startServerPolling();
    }
});

// ========================================
// Init — start all polling
// ========================================

export function initPolling() {
    ensureEls();
    startTmuxPolling();
    startUsagePolling();
    startServerPolling();
    // Notification polling is controlled by setNotifyEnabled()

    // Click-to-refresh on status bar elements
    if (usageEl) {
        usageEl.style.cursor = 'pointer';
        usageEl.addEventListener('click', function() {
            fetchClaudeUsage();
            var data = window._cachedUsageData;
            if (data && data.five_hour) {
                var info = [];
                info.push('5h: ' + Math.round(parseFloat(data.five_hour.utilization) * 100) + '%');
                if (data.seven_day) {
                    info.push('7d: ' + Math.round(parseFloat(data.seven_day.utilization) * 100) + '%');
                }
                if (data.status) info.push(data.status);
                showToast(info.join(' · '));
            } else {
                showToast(t('polling.usageRefreshed'));
            }
        });
    }
    if (serverStatusEl) {
        serverStatusEl.style.cursor = 'pointer';
        serverStatusEl.addEventListener('click', function() {
            fetchServerStatus();
            if (lastServerData) {
                var s = lastServerData;
                var msg = 'CPU: ' + s.cpu + '% · MEM: ' + s.mem + '% (' + s.memUsedGB + '/' + s.memTotalGB + 'GB) · DISK: ' + s.disk + '%';
                if (s.temp != null) msg += ' · TEMP: ' + s.temp + '°C';
                showToast(msg, 3500);
            }
        });
    }
}
