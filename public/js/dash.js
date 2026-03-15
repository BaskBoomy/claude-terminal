import { escapeHtml, showToast, colorForPct, colorForTemp } from './utils.js';
import { t } from './i18n.js';
import { T } from './theme.js';
import { I, icon } from './icons.js';
import { getCachedUsageData, getLastServerData, fetchClaudeUsage } from './polling.js';

// --- State ---
let contentEl = null;
let lastDashLoad = 0;
let gitRepos = [];
let selectedRepoId = null;

// --- Init ---
export function initDash() {
    contentEl = document.getElementById('dash-content');
    try {
        selectedRepoId = localStorage.getItem('dash-selected-repo');
    } catch (e) {}
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
        .then(function(data) {
            gitRepos = (data && data.repos) || [];
            // Auto-select first repo if none selected
            if (!selectedRepoId && gitRepos.length > 0) {
                selectedRepoId = gitRepos[0].id;
            }

            var usage = getCachedUsageData();
            var server = getLastServerData();
            contentEl.innerHTML =
                renderUsageSection(usage) +
                renderGitSection(gitRepos, selectedRepoId) +
                renderServerSection(server);

            bindGitEvents();
            bindUsageRefresh();
            if (done) done();
        });
}

function bindGitEvents() {
    // Repo chip click
    var chips = contentEl.querySelectorAll('.git-repo-chip');
    chips.forEach(function(chip) {
        chip.addEventListener('click', function() {
            selectedRepoId = chip.dataset.repo;
            try { localStorage.setItem('dash-selected-repo', selectedRepoId); } catch(e) {}
            // Re-render git section only
            var gitWrap = contentEl.querySelector('.dash-git-wrap');
            if (gitWrap) {
                gitWrap.outerHTML = renderGitSection(gitRepos, selectedRepoId);
                bindGitEvents();
            }
        });
    });
    // File toggle
    var toggleBtn = contentEl.querySelector('.git-files-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            var sec = contentEl.querySelector('.git-files-section');
            if (sec) {
                var open = sec.classList.toggle('open');
                toggleBtn.innerHTML = open ? icon('chevronUp', 12) + ' ' + t('dash.hideFiles') : icon('chevronDown', 12) + ' ' + t('dash.showFiles');
            }
        });
    }
}

function bindUsageRefresh() {
    var btn = document.getElementById('usage-refresh-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
        btn.classList.add('spinning');
        btn.disabled = true;
        fetchClaudeUsage();
        // Wait for fetch to update cache, then re-render usage section
        setTimeout(function() {
            var usage = getCachedUsageData();
            var section = contentEl.querySelector('.dash-section');
            if (section) {
                section.outerHTML = renderUsageSection(usage);
                bindUsageRefresh();
            }
            btn.classList.remove('spinning');
            btn.disabled = false;
            showToast(t('polling.usageRefreshed'));
        }, 2000);
    });
}

// --- Usage helpers ---
function _parsePct(v) { return Math.round(parseFloat(v) * 100); }
function _parseReset(v) { return new Date(parseInt(v, 10) * 1000); }
function _fmtTime(resetAt) {
    var diff = resetAt - Date.now();
    if (diff <= 0) return 'resetting...';
    var m = Math.floor(diff / 60000), h = Math.floor(m / 60);
    m = m % 60;
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
function _pctColor(pct) {
    return pct >= 80 ? T.danger() : pct >= 50 ? T.warn : T.successText();
}
function _statusBadge(status) {
    if (!status) return '';
    var color = status === 'allowed' ? T.successText() : status === 'allowed_warning' ? T.warn : T.danger();
    return '<span class="usage-status" style="color:' + color + '">' + escapeHtml(status) + '</span>';
}

// --- Usage section ---
function renderUsageSection(data) {
    var html = '<div class="dash-section">';
    html += '<div class="dash-section-title"><span style="color:' + T.accent() + '">' + icon('zap', 16) + '</span> Claude Usage<button class="dash-refresh-btn" id="usage-refresh-btn">' + icon('refreshCw', 14) + '</button></div>';
    if (!data || data.error || !data.five_hour) {
        var errMsg = (data && data.error && data.error.indexOf('429') !== -1)
            ? t('dash.rateLimited')
            : t('dash.usageWaiting');
        html += '<div class="dash-empty">' + errMsg + '</div>';
        return html + '</div>';
    }

    // 5h window — primary
    var pct5h = _parsePct(data.five_hour.utilization);
    var reset5h = _parseReset(data.five_hour.resets_at);
    var barColor = _pctColor(pct5h);

    html += '<div class="usage-card">';
    html += '<div class="usage-header">';
    html += '<div class="usage-pct" style="color:' + barColor + '">' + pct5h + '%<small> used</small></div>';
    html += '<div class="usage-reset">' + t('dash.reset', { time: _fmtTime(reset5h) }) + '</div>';
    html += '</div>';
    html += '<div class="usage-bar-bg"><div class="usage-bar-fill" style="width:' + pct5h + '%;background:' + barColor + '"></div></div>';

    // Stats row: 5h + 7d
    html += '<div class="usage-daily-row">';
    html += '<div class="usage-daily-item"><div class="usage-daily-label">5H</div><div class="usage-daily-val" style="color:' + _pctColor(pct5h) + '">' + pct5h + '%</div><div class="usage-daily-sub">' + _fmtTime(reset5h) + '</div></div>';
    if (data.seven_day) {
        var pct7d = _parsePct(data.seven_day.utilization);
        var reset7d = _parseReset(data.seven_day.resets_at);
        html += '<div class="usage-daily-item"><div class="usage-daily-label">7D</div><div class="usage-daily-val" style="color:' + _pctColor(pct7d) + '">' + pct7d + '%</div><div class="usage-daily-sub">' + _fmtTime(reset7d) + '</div></div>';
    }
    html += '</div>';

    // Extra info row
    var extras = [];
    if (data.status) extras.push(['Status', _statusBadge(data.status)]);
    if (data.overage_status) extras.push(['Overage', _statusBadge(data.overage_status)]);
    if (data.fallback_percentage) extras.push(['Fallback', Math.round(parseFloat(data.fallback_percentage) * 100) + '%']);
    if (data.representative_claim) extras.push(['Limit', escapeHtml(data.representative_claim.replace('_', ' '))]);

    if (extras.length) {
        html += '<div class="usage-extras">';
        for (var i = 0; i < extras.length; i++) {
            html += '<div class="usage-extra-item"><span class="usage-extra-label">' + extras[i][0] + '</span> ' + extras[i][1] + '</div>';
        }
        html += '</div>';
    }

    html += '</div></div>';
    return html;
}

// --- Git section ---
function renderGitSection(repos, activeId) {
    var html = '<div class="dash-git-wrap"><div class="dash-section">';
    html += '<div class="dash-section-title"><span style="color:' + T.textMuted() + '">' + icon('package', 16) + '</span> Git Status</div>';

    if (!repos || repos.length === 0) {
        html += '<div class="dash-empty">' + t('dash.noGitRepo') + '</div>';
        return html + '</div></div>';
    }

    // Repo selector chips
    if (repos.length > 1) {
        html += '<div class="git-repo-chips">';
        repos.forEach(function(repo) {
            var active = repo.id === activeId ? ' active' : '';
            var badge = '';
            if (repo.changes && repo.changes.total > 0) {
                badge = '<span class="git-chip-badge">' + repo.changes.total + '</span>';
            }
            html += '<button class="git-repo-chip' + active + '" data-repo="' + escapeHtml(repo.id) + '">' + escapeHtml(repo.id) + badge + '</button>';
        });
        html += '</div>';
    }

    // Find selected repo
    var git = repos.find(function(r) { return r.id === activeId; }) || repos[0];

    if (git.error) {
        html += '<div class="dash-empty">' + escapeHtml(git.error) + '</div>';
        return html + '</div></div>';
    }

    html += '<div class="git-card">';
    // Branch row
    html += '<div class="git-branch-row">';
    html += '<span class="git-branch-icon" style="color:' + T.successText() + '">' + icon('chevronRight', 14) + '</span>';
    html += '<span class="git-branch-name">' + escapeHtml(git.branch || 'detached') + '</span>';
    if (git.ahead > 0) html += '<span class="git-badge ahead">' + icon('arrowUp', 10) + git.ahead + '</span>';
    if (git.behind > 0) html += '<span class="git-badge behind">' + icon('arrowDown', 10) + git.behind + '</span>';
    if (git.changes && git.changes.total === 0) html += '<span class="git-badge clean">' + icon('checkCircle', 10) + ' clean</span>';
    html += '</div>';

    // Changes summary
    if (git.changes && git.changes.total > 0) {
        var c = git.changes;
        html += '<div class="git-changes-row">';
        html += '<div class="git-change-item"><div class="git-change-num" style="color:' + T.successText() + '">' + c.staged + '</div><div class="git-change-label">Staged</div></div>';
        html += '<div class="git-change-item"><div class="git-change-num" style="color:' + T.warn + '">' + c.modified + '</div><div class="git-change-label">Modified</div></div>';
        html += '<div class="git-change-item"><div class="git-change-num" style="color:' + T.textSubtle() + '">' + c.untracked + '</div><div class="git-change-label">Untracked</div></div>';
        html += '</div>';

        // File list (collapsed)
        if (git.files && git.files.length > 0) {
            html += '<div class="git-files-section">';
            git.files.forEach(function(f) {
                var st = f.status || '?';
                var stClass = st.replace(/[^A-Z?]/g, '').charAt(0);
                if (stClass === '?') stClass = 'U';
                html += '<div class="git-file-row"><span class="git-file-status ' + stClass + '">' + escapeHtml(st) + '</span><span class="git-file-name">' + escapeHtml(f.file) + '</span></div>';
            });
            html += '</div>';
            html += '<button class="git-files-toggle">' + icon('chevronDown', 12) + ' ' + t('dash.showFiles') + '</button>';
        }
    }

    // Recent commits
    if (git.commits && git.commits.length > 0) {
        html += '<div class="git-commit-list">';
        git.commits.forEach(function(c) {
            html += '<div class="git-commit-item">';
            html += '<span class="git-commit-hash">' + escapeHtml(c.hash) + '</span>';
            html += '<span class="git-commit-msg">' + escapeHtml(c.message) + '</span>';
            html += '<span class="git-commit-ago">' + escapeHtml(c.time) + '</span>';
            html += '</div>';
        });
        html += '</div>';
    }
    html += '</div></div></div>';
    return html;
}

// --- Server section ---
function renderServerSection(s) {
    if (!s) return '';
    var html = '<div class="dash-section">';
    html += '<div class="dash-section-title"><span style="color:' + T.textMuted() + '">' + icon('terminal', 16) + '</span> Server</div>';
    html += '<div class="usage-card"><div class="usage-daily-row">';
    if (s.cpu != null) html += '<div class="usage-daily-item"><div class="usage-daily-label">CPU</div><div class="usage-daily-val" style="color:' + (s.cpu >= 80 ? T.danger() : T.text()) + '">' + s.cpu + '%</div></div>';
    if (s.mem != null) html += '<div class="usage-daily-item"><div class="usage-daily-label">MEM</div><div class="usage-daily-val" style="color:' + (s.mem >= 80 ? T.danger() : T.text()) + '">' + s.memUsedGB + '/' + s.memTotalGB + 'G</div></div>';
    if (s.disk != null) html += '<div class="usage-daily-item"><div class="usage-daily-label">DISK</div><div class="usage-daily-val">' + s.disk + '%</div></div>';
    if (s.temp != null) html += '<div class="usage-daily-item"><div class="usage-daily-label">TEMP</div><div class="usage-daily-val" style="color:' + (s.temp >= 70 ? T.danger() : s.temp >= 55 ? T.warn : T.text()) + '">' + s.temp + '°C</div></div>';
    html += '</div></div></div>';
    return html;
}
