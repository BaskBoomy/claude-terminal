import { escapeHtml, showConfirm, showToast } from './utils.js';
import { t } from './i18n.js';
import { T } from './theme.js';
import { I, icon } from './icons.js';

// --- State ---
let contentEl = null;
let lastLoad = 0;
let pollTimer = null;
let currentView = 'list'; // 'list' | 'detail'
let selectedSession = null;
let feedbackDirty = false;
let feedbackTimer = null;

// --- Init ---
export function initMonitor() {
    contentEl = document.getElementById('monitor-content');
}

// --- Main loader ---
export function loadMonitor(done) {
    if (currentView === 'detail' && selectedSession) {
        loadDetail(selectedSession, done);
        return;
    }
    loadList(done);
}

function loadList(done) {
    fetch('/api/monitor', { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; })
        .then(function(data) {
            var sessions = (data && data.sessions) || [];
            currentView = 'list';
            selectedSession = null;
            contentEl.innerHTML = renderList(sessions);
            bindListEvents(sessions);
            if (done) done();
        });
}

function loadDetail(name, done) {
    fetch('/api/monitor/' + encodeURIComponent(name), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; })
        .then(function(data) {
            if (!data) {
                contentEl.innerHTML = '<div class="dash-empty">Session not found</div>';
                if (done) done();
                return;
            }
            currentView = 'detail';
            selectedSession = name;
            contentEl.innerHTML = renderDetail(data);
            bindDetailEvents(data);
            if (done) done();
        });
}

// --- Polling ---
export function startMonitorPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function() {
        loadMonitor();
    }, 5000);
}

export function stopMonitorPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// --- Render List ---
function renderList(sessions) {
    var html = '<div class="dash-section">';
    html += '<div class="dash-section-title"><span style="color:' + T.accent() + '">' + icon('barChart', 16) + '</span> Monitor</div>';

    if (sessions.length === 0) {
        html += '<div class="dash-empty" style="text-align:center;padding:40px 16px">';
        html += '<div style="margin-bottom:12px;color:' + T.textMuted() + '">' + icon('terminal', 32) + '</div>';
        html += '<div style="font-size:14px;color:' + T.textMuted() + '">No claude-loop sessions found</div>';
        html += '<div style="font-size:12px;color:' + T.textSubtle() + ';margin-top:6px">Sessions starting with "cl-" will appear here</div>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    sessions.forEach(function(s) {
        var statusColor = s.status === 'running' ? T.successText() : s.status === 'completed' ? T.accent() : T.textSubtle();
        var statusLabel = s.status.charAt(0).toUpperCase() + s.status.slice(1);
        var total = s.tasks.done + s.tasks.progress + s.tasks.todo;
        var pct = total > 0 ? Math.round(s.tasks.done / total * 100) : 0;
        var elapsed = formatElapsed(s.elapsed);
        var dirShort = s.dir ? s.dir.replace(/^\/home\/\w+\//, '~/') : '';

        html += '<div class="mon-session-card" data-name="' + escapeHtml(s.name) + '">';
        html += '<div class="mon-session-header">';
        html += '<div class="mon-session-name">' + escapeHtml(s.name) + '</div>';
        html += '<span class="mon-status-badge" style="background:' + statusColor + '">' + statusLabel + '</span>';
        html += '</div>';

        if (dirShort) {
            html += '<div class="mon-session-dir">' + escapeHtml(dirShort) + '</div>';
        }

        html += '<div class="mon-session-stats">';
        if (s.iteration > 0) {
            html += '<span class="mon-stat">Iter: ' + s.iteration + '</span>';
        }
        html += '<span class="mon-stat">Tasks: ' + s.tasks.done + '/' + total + '</span>';
        if (elapsed) {
            html += '<span class="mon-stat">' + elapsed + '</span>';
        }
        html += '</div>';

        // Progress bar
        if (total > 0) {
            var donePct = (s.tasks.done / total * 100);
            var progPct = (s.tasks.progress / total * 100);
            html += '<div class="mon-progress-bar">';
            html += '<div class="mon-progress-done" style="width:' + donePct + '%"></div>';
            html += '<div class="mon-progress-active" style="width:' + progPct + '%"></div>';
            html += '</div>';
        }

        html += '</div>';
    });

    html += '</div>';
    return html;
}

// --- Render Detail ---
function renderDetail(data) {
    var statusColor = data.status === 'running' ? T.successText() : data.status === 'completed' ? T.accent() : T.textSubtle();
    var statusLabel = data.status.charAt(0).toUpperCase() + data.status.slice(1);
    var total = data.tasks.done + data.tasks.progress + data.tasks.todo;
    var pct = total > 0 ? Math.round(data.tasks.done / total * 100) : 0;
    var elapsed = formatElapsed(data.elapsed);
    var dirShort = data.dir ? data.dir.replace(/^\/home\/\w+\//, '~/') : '';

    var html = '';

    // Back button + header
    html += '<div class="dash-section" style="padding-bottom:12px">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
    html += '<button id="mon-back-btn" class="mon-icon-btn">' + icon('chevronLeft', 14) + '</button>';
    html += '<div style="flex:1">';
    html += '<div style="display:flex;align-items:center;gap:8px">';
    html += '<span style="font-size:16px;font-weight:700;color:' + T.text() + '">' + escapeHtml(data.name) + '</span>';
    html += '<span class="mon-status-badge" style="background:' + statusColor + '">' + statusLabel + '</span>';
    html += '</div>';
    if (dirShort) {
        html += '<div style="font-size:12px;color:' + T.textSubtle() + ';margin-top:2px">' + escapeHtml(dirShort) + '</div>';
    }
    html += '</div>';
    // Controls
    html += '<button id="mon-refresh-btn" class="mon-icon-btn" title="Refresh">' + icon('refresh', 14) + '</button>';
    if (data.status === 'running') {
        html += '<button id="mon-stop-btn" class="mon-icon-btn" style="color:' + T.danger() + ';border-color:' + T.danger() + '" title="Stop">' + icon('x', 14) + '</button>';
    }
    html += '</div>';

    // Stats row
    html += '<div class="mon-detail-stats">';
    if (data.iteration > 0) {
        html += '<div class="mon-detail-stat"><div class="mon-detail-stat-label">ITERATION</div><div class="mon-detail-stat-val">' + data.iteration + '</div></div>';
    }
    html += '<div class="mon-detail-stat"><div class="mon-detail-stat-label">DONE</div><div class="mon-detail-stat-val" style="color:' + T.successText() + '">' + data.tasks.done + '</div></div>';
    html += '<div class="mon-detail-stat"><div class="mon-detail-stat-label">ACTIVE</div><div class="mon-detail-stat-val" style="color:' + T.accent() + '">' + data.tasks.progress + '</div></div>';
    html += '<div class="mon-detail-stat"><div class="mon-detail-stat-label">TODO</div><div class="mon-detail-stat-val">' + data.tasks.todo + '</div></div>';
    if (elapsed) {
        html += '<div class="mon-detail-stat"><div class="mon-detail-stat-label">ELAPSED</div><div class="mon-detail-stat-val">' + elapsed + '</div></div>';
    }
    html += '</div>';

    // Progress bar
    if (total > 0) {
        var donePct = (data.tasks.done / total * 100);
        var progPct = (data.tasks.progress / total * 100);
        html += '<div class="mon-progress-bar" style="height:8px;margin-top:8px">';
        html += '<div class="mon-progress-done" style="width:' + donePct + '%"></div>';
        html += '<div class="mon-progress-active" style="width:' + progPct + '%"></div>';
        html += '</div>';
        html += '<div style="text-align:right;font-size:11px;color:' + T.textSubtle() + ';margin-top:4px;font-family:\'SF Mono\',monospace">' + pct + '% complete</div>';
    }

    if (data.rollbackTag) {
        html += '<div style="font-size:11px;color:' + T.textSubtle() + ';margin-top:6px">Rollback: <code style="color:' + T.textMuted() + '">' + escapeHtml(data.rollbackTag) + '</code></div>';
    }
    html += '</div>';

    // TASKS.md
    if (data.tasksContent) {
        html += '<div class="dash-section">';
        html += '<div class="dash-section-title"><span style="color:' + T.accent() + '">' + icon('clipboardList', 16) + '</span> Tasks</div>';
        html += '<div class="mon-md-content">' + renderTasksMd(data.tasksContent) + '</div>';
        html += '</div>';
    }

    // Latest log
    if (data.latestLog) {
        html += '<div class="dash-section">';
        html += '<div class="dash-section-title"><span style="color:' + T.textMuted() + '">' + icon('terminal', 16) + '</span> Latest Log</div>';
        html += '<pre class="mon-log-content">' + escapeHtml(data.latestLog) + '</pre>';
        html += '</div>';
    }

    // FEEDBACK.md (editable)
    html += '<div class="dash-section">';
    html += '<div class="dash-section-title"><span style="color:' + T.accent() + '">' + icon('messageCircle', 16) + '</span> Feedback</div>';
    html += '<textarea id="mon-feedback" class="mon-feedback-area" placeholder="Write feedback for the claude-loop agent...">' + escapeHtml(data.feedback || '') + '</textarea>';
    html += '<div id="mon-feedback-status" class="mon-feedback-status"></div>';
    html += '</div>';

    // LEARNINGS.md (collapsible)
    if (data.learnings) {
        html += '<div class="dash-section">';
        html += '<div class="mon-collapsible-hdr" id="mon-learnings-toggle">';
        html += '<span style="color:' + T.textMuted() + '">' + icon('bookOpen', 16) + '</span>';
        html += '<span style="flex:1;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:' + T.accent() + '">Learnings</span>';
        html += '<span style="color:' + T.textSubtle() + '">' + icon('chevronDown', 12) + '</span>';
        html += '</div>';
        html += '<div class="mon-collapsible-body" id="mon-learnings-body" style="display:none">';
        html += '<pre class="mon-log-content">' + escapeHtml(data.learnings) + '</pre>';
        html += '</div>';
        html += '</div>';
    }

    // PROGRESS.md (collapsible)
    if (data.progress) {
        html += '<div class="dash-section">';
        html += '<div class="mon-collapsible-hdr" id="mon-progress-toggle">';
        html += '<span style="color:' + T.textMuted() + '">' + icon('trendingUp', 16) + '</span>';
        html += '<span style="flex:1;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:' + T.accent() + '">Progress</span>';
        html += '<span style="color:' + T.textSubtle() + '">' + icon('chevronDown', 12) + '</span>';
        html += '</div>';
        html += '<div class="mon-collapsible-body" id="mon-progress-body" style="display:none">';
        html += '<pre class="mon-log-content">' + escapeHtml(data.progress) + '</pre>';
        html += '</div>';
        html += '</div>';
    }

    return html;
}

// --- Render TASKS.md with status highlighting ---
function renderTasksMd(content) {
    var lines = content.split('\n');
    var html = '';
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var trimmed = line.replace(/^\s+/, '');
        var indent = line.length - trimmed.length;
        var indentPx = indent * 8;

        if (trimmed.startsWith('# ')) {
            html += '<div style="font-size:14px;font-weight:700;color:' + T.text() + ';margin:8px 0 4px">' + escapeHtml(trimmed.substring(2)) + '</div>';
        } else if (trimmed.startsWith('## ')) {
            html += '<div style="font-size:13px;font-weight:600;color:' + T.textMuted() + ';margin:6px 0 3px">' + escapeHtml(trimmed.substring(3)) + '</div>';
        } else if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
            html += '<div class="mon-task-line" style="padding-left:' + indentPx + 'px"><span class="mon-task-done">' + icon('checkCircle', 14) + '</span><span style="text-decoration:line-through;color:' + T.textSubtle() + '">' + escapeHtml(trimmed.substring(6)) + '</span></div>';
        } else if (trimmed.startsWith('- [~]') || trimmed.startsWith('- [>]')) {
            html += '<div class="mon-task-line" style="padding-left:' + indentPx + 'px"><span class="mon-task-active">' + icon('zap', 14) + '</span><span style="color:' + T.accent() + '">' + escapeHtml(trimmed.substring(6)) + '</span></div>';
        } else if (trimmed.startsWith('- [ ]')) {
            html += '<div class="mon-task-line" style="padding-left:' + indentPx + 'px"><span class="mon-task-todo">' + icon('minus', 14) + '</span><span>' + escapeHtml(trimmed.substring(6)) + '</span></div>';
        } else if (trimmed.startsWith('- ')) {
            html += '<div class="mon-task-line" style="padding-left:' + indentPx + 'px"><span style="color:' + T.textSubtle() + ';margin-right:6px">-</span>' + escapeHtml(trimmed.substring(2)) + '</div>';
        } else if (trimmed) {
            html += '<div style="padding-left:' + indentPx + 'px;color:' + T.textMuted() + ';font-size:13px">' + escapeHtml(trimmed) + '</div>';
        }
    }
    return html;
}

// --- Events ---
function bindListEvents(sessions) {
    contentEl.querySelectorAll('.mon-session-card').forEach(function(card) {
        card.addEventListener('click', function() {
            var name = card.dataset.name;
            loadDetail(name);
        });
    });
}

function bindDetailEvents(data) {
    // Back button
    var backBtn = document.getElementById('mon-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            currentView = 'list';
            selectedSession = null;
            loadList();
        });
    }

    // Refresh
    var refreshBtn = document.getElementById('mon-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            loadDetail(data.name);
        });
    }

    // Stop
    var stopBtn = document.getElementById('mon-stop-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', function() {
            showConfirm('Stop session "' + data.name + '"?', [
                { label: 'Stop', style: 'primary', action: function() {
                    fetch('/api/monitor/' + encodeURIComponent(data.name) + '/stop', {
                        method: 'POST', credentials: 'same-origin'
                    }).then(function() {
                        showToast('Stop signal sent');
                        setTimeout(function() { loadDetail(data.name); }, 1000);
                    });
                }},
                { label: 'Cancel', style: 'cancel' }
            ]);
        });
    }

    // Feedback auto-save
    var feedbackEl = document.getElementById('mon-feedback');
    var statusEl = document.getElementById('mon-feedback-status');
    if (feedbackEl) {
        feedbackEl.addEventListener('input', function() {
            feedbackDirty = true;
            statusEl.textContent = 'Unsaved';
            statusEl.style.color = T.warn;
            clearTimeout(feedbackTimer);
            feedbackTimer = setTimeout(function() {
                saveFeedback(data.name, feedbackEl.value, statusEl);
            }, 1500);
        });
    }

    // Collapsible sections
    bindCollapsible('mon-learnings-toggle', 'mon-learnings-body');
    bindCollapsible('mon-progress-toggle', 'mon-progress-body');
}

function bindCollapsible(toggleId, bodyId) {
    var toggle = document.getElementById(toggleId);
    var body = document.getElementById(bodyId);
    if (toggle && body) {
        toggle.addEventListener('click', function() {
            var open = body.style.display !== 'none';
            body.style.display = open ? 'none' : 'block';
        });
    }
}

function saveFeedback(name, content, statusEl) {
    fetch('/api/monitor/' + encodeURIComponent(name) + '/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content })
    }).then(function(r) {
        if (r.ok) {
            feedbackDirty = false;
            statusEl.textContent = 'Saved';
            statusEl.style.color = T.successText();
            setTimeout(function() {
                if (!feedbackDirty) statusEl.textContent = '';
            }, 2000);
        }
    });
}

// --- Helpers ---
function formatElapsed(seconds) {
    if (!seconds || seconds <= 0) return '';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
}
