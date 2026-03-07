import { escapeHtml, colorForPct, colorForTemp } from './utils.js';
import { getCachedUsageData, getLastServerData } from './polling.js';

// --- State ---
let contentEl = null;
let lastDashLoad = 0;

// --- Init ---
export function initDash() {
    contentEl = document.getElementById('dash-content');
}

// --- Main loader ---
export function loadDashboard(done) {
    if (!done && Date.now() - lastDashLoad < 3000 && contentEl.innerHTML) {
        return;
    }
    lastDashLoad = Date.now();

    fetch('/api/git-status', { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; })
        .then(function(git) {
            var usage = getCachedUsageData();
            var server = getLastServerData();
            contentEl.innerHTML =
                renderUsageSection(usage) +
                renderGitSection(git) +
                renderServerSection(server);

            var toggleBtn = contentEl.querySelector('.git-files-toggle');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', function() {
                    var sec = contentEl.querySelector('.git-files-section');
                    if (sec) {
                        var open = sec.classList.toggle('open');
                        toggleBtn.textContent = open ? '▲ 파일 숨기기' : '▼ 변경 파일 보기';
                    }
                });
            }
            if (done) done();
        });
}

// --- Usage section ---
function renderUsageSection(data) {
    var html = '<div class="dash-section">';
    html += '<div class="dash-section-title"><span>⚡</span> Claude Usage</div>';
    if (!data || data.error || !data.five_hour) {
        var errMsg = (data && data.error && data.error.indexOf('429') !== -1)
            ? 'Rate limited — 잠시 후 자동 갱신됩니다'
            : '사용량 정보 대기 중...';
        html += '<div class="dash-empty">' + errMsg + '</div>';
        return html + '</div>';
    }
    var pct = Math.round(data.five_hour.utilization);
    var resetAt = new Date(data.five_hour.resets_at);
    var diffMs = resetAt - Date.now();
    var timeStr = '';
    if (diffMs > 0) {
        var totalMin = Math.floor(diffMs / 60000);
        var h = Math.floor(totalMin / 60);
        var m = totalMin % 60;
        timeStr = h > 0 ? h + 'h ' + m + 'm' : m + 'm';
    } else {
        timeStr = 'resetting...';
    }
    var barColor = pct >= 80 ? '#ff6b6b' : pct >= 50 ? '#e8b84b' : '#8ab563';

    html += '<div class="usage-card">';
    html += '<div class="usage-header">';
    html += '<div class="usage-pct">' + pct + '%<small> used</small></div>';
    html += '<div class="usage-reset">리셋 ' + timeStr + '</div>';
    html += '</div>';
    html += '<div class="usage-bar-bg"><div class="usage-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>';

    // Daily/weekly if available
    if (data.daily) {
        var dPct = Math.round(data.daily.utilization);
        html += '<div class="usage-daily-row">';
        html += '<div class="usage-daily-item"><div class="usage-daily-label">5H WINDOW</div><div class="usage-daily-val">' + pct + '%</div></div>';
        html += '<div class="usage-daily-item"><div class="usage-daily-label">DAILY</div><div class="usage-daily-val">' + dPct + '%</div></div>';
        if (data.weekly) {
            var wPct = Math.round(data.weekly.utilization);
            html += '<div class="usage-daily-item"><div class="usage-daily-label">WEEKLY</div><div class="usage-daily-val">' + wPct + '%</div></div>';
        }
        html += '</div>';
    }
    html += '</div></div>';
    return html;
}

// --- Git section ---
function renderGitSection(git) {
    var html = '<div class="dash-section">';
    html += '<div class="dash-section-title"><span>📦</span> Git Status</div>';
    if (!git || git.error) {
        html += '<div class="dash-empty">Git 정보를 불러올 수 없습니다</div>';
        return html + '</div>';
    }
    html += '<div class="git-card">';
    // Branch row
    html += '<div class="git-branch-row">';
    html += '<span class="git-branch-icon">🌿</span>';
    html += '<span class="git-branch-name">' + escapeHtml(git.branch || 'detached') + '</span>';
    if (git.ahead > 0) html += '<span class="git-badge ahead">↑' + git.ahead + '</span>';
    if (git.behind > 0) html += '<span class="git-badge behind">↓' + git.behind + '</span>';
    if (git.changes && git.changes.total === 0) html += '<span class="git-badge clean">✓ clean</span>';
    html += '</div>';

    // Changes summary
    if (git.changes && git.changes.total > 0) {
        var c = git.changes;
        html += '<div class="git-changes-row">';
        html += '<div class="git-change-item"><div class="git-change-num" style="color:#8ab563">' + c.staged + '</div><div class="git-change-label">Staged</div></div>';
        html += '<div class="git-change-item"><div class="git-change-num" style="color:#e8b84b">' + c.unstaged + '</div><div class="git-change-label">Modified</div></div>';
        html += '<div class="git-change-item"><div class="git-change-num" style="color:#6a6158">' + c.untracked + '</div><div class="git-change-label">Untracked</div></div>';
        html += '</div>';

        // File list (collapsed)
        if (git.files && git.files.length > 0) {
            html += '<div class="git-files-section">';
            git.files.forEach(function(line) {
                var st = line.substring(0, 2).trim() || '?';
                var fname = line.substring(3);
                var stClass = st.replace(/[^A-Z?]/g, '').charAt(0);
                if (stClass === '?') stClass = 'U';
                html += '<div class="git-file-row"><span class="git-file-status ' + stClass + '">' + escapeHtml(st) + '</span><span class="git-file-name">' + escapeHtml(fname) + '</span></div>';
            });
            html += '</div>';
            html += '<button class="git-files-toggle">▼ 변경 파일 보기</button>';
        }
    }

    // Recent commits
    if (git.commits && git.commits.length > 0) {
        html += '<div class="git-commit-list">';
        git.commits.forEach(function(c) {
            html += '<div class="git-commit-item">';
            html += '<span class="git-commit-hash">' + escapeHtml(c.hash) + '</span>';
            html += '<span class="git-commit-msg">' + escapeHtml(c.message) + '</span>';
            html += '<span class="git-commit-ago">' + escapeHtml(c.ago) + '</span>';
            html += '</div>';
        });
        html += '</div>';
    }
    html += '</div></div>';
    return html;
}

// --- Server section ---
function renderServerSection(s) {
    if (!s) return '';
    var html = '<div class="dash-section">';
    html += '<div class="dash-section-title"><span>🖥</span> Server</div>';
    html += '<div class="usage-card"><div class="usage-daily-row">';
    if (s.cpu != null) html += '<div class="usage-daily-item"><div class="usage-daily-label">CPU</div><div class="usage-daily-val" style="color:' + (s.cpu >= 80 ? '#ff6b6b' : '#e8e6e3') + '">' + s.cpu + '%</div></div>';
    if (s.mem != null) html += '<div class="usage-daily-item"><div class="usage-daily-label">MEM</div><div class="usage-daily-val" style="color:' + (s.mem >= 80 ? '#ff6b6b' : '#e8e6e3') + '">' + s.memUsedGB + '/' + s.memTotalGB + 'G</div></div>';
    if (s.disk != null) html += '<div class="usage-daily-item"><div class="usage-daily-label">DISK</div><div class="usage-daily-val">' + s.disk + '%</div></div>';
    if (s.temp != null) html += '<div class="usage-daily-item"><div class="usage-daily-label">TEMP</div><div class="usage-daily-val" style="color:' + (s.temp >= 70 ? '#ff6b6b' : s.temp >= 55 ? '#e8b84b' : '#e8e6e3') + '">' + s.temp + '°C</div></div>';
    html += '</div></div></div>';
    return html;
}
