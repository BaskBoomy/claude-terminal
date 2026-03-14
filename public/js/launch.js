import { escapeHtml, showConfirm, showToast } from './utils.js';
import { t } from './i18n.js';
import { T } from './theme.js';
import { I, icon } from './icons.js';

// --- State ---
let contentEl = null;
let lastLoad = 0;
let subView = 'overview'; // 'overview' | 'checklist'
let status = null;
let items = [];
let expandedAreas = {};
let editingDate = false;

// Area display order + icons
var AREAS = [
    { key: 'feature', icon: I.settings },
    { key: 'billing', icon: I.creditCard },
    { key: 'infra', icon: I.building },
    { key: 'security', icon: I.lock },
    { key: 'legal', icon: I.scale },
    { key: 'monitoring', icon: I.barChart },
    { key: 'testing', icon: I.testTube },
    { key: 'marketing', icon: I.megaphone },
    { key: 'performance', icon: I.zap },
    { key: 'dr', icon: I.refreshCw },
    { key: 'support', icon: I.messageCircle },
    { key: 'docs', icon: I.bookOpen },
    { key: 'migration', icon: I.package },
    { key: 'seo', icon: I.search },
    { key: 'analytics', icon: I.trendingUp },
    { key: 'continuity', icon: I.buildingOffice },
];

var PRIO_COLORS = {
    'P0': { bg: '#3a1a1a', text: '#ff6b6b', labelKey: 'launch.prio.blocker' },
    'P1': { bg: '#3a2a1a', text: '#e8b84b', labelKey: 'launch.prio.required' },
    'P2': { bg: '#1a2a3a', text: '#6ba3ff', labelKey: 'launch.prio.recommended' },
    'P3': { bg: '#1a3a2a', text: '#6bbb6b', labelKey: 'launch.prio.low' },
};

// --- Init ---
export function initLaunch() {
    contentEl = document.getElementById('launch-content');
}

// --- Main loader ---
export function loadLaunch(done) {
    if (!done && Date.now() - lastLoad < 3000 && contentEl.innerHTML) return;
    lastLoad = Date.now();

    Promise.all([
        fetch('/api/launch/status', { credentials: 'same-origin' }).then(function(r) { return r.ok ? r.json() : null; }),
        fetch('/api/launch/items', { credentials: 'same-origin' }).then(function(r) { return r.ok ? r.json() : null; })
    ]).then(function(results) {
        status = results[0];
        items = (results[1] && results[1].items) || [];
        render();
        if (done) done();
    }).catch(function() {
        contentEl.innerHTML = '<div class="dash-empty">' + t('launch.loadFailed') + '</div>';
        if (done) done();
    });
}

// --- Render ---
function render() {
    if (!status && items.length === 0) {
        contentEl.innerHTML = renderEmpty();
        bindSeedBtn();
        return;
    }
    contentEl.innerHTML = renderHeader() + renderSubTabs() +
        (subView === 'overview' ? renderOverview() : renderChecklist());
    bindEvents();
}

function renderEmpty() {
    return '<div class="dash-section" style="text-align:center;padding:60px 16px">' +
        '<div style="margin-bottom:16px;color:' + T.textMuted() + '">' + icon('rocket', 48) + '</div>' +
        '<div style="font-size:16px;color:' + T.text() + ';margin-bottom:8px">' + t('launch.tracker') + '</div>' +
        '<div style="font-size:13px;color:' + T.textMuted() + ';margin-bottom:24px">' + t('launch.initDesc') + '</div>' +
        '<button id="launch-seed-btn" class="launch-btn launch-btn-primary">' + t('launch.initBtn') + '</button>' +
        '</div>';
}

function renderHeader() {
    if (!status) return '';
    var s = status;
    var ddayText = s.dday > 0 ? 'D-' + s.dday : s.dday === 0 ? 'D-DAY' : 'D+' + Math.abs(s.dday);
    var barColor = s.pct >= 80 ? T.successText() : s.pct >= 50 ? T.warn : T.accent();
    var ddayColor = s.dday <= 7 ? T.danger() : s.dday <= 14 ? T.warn : T.text();

    var html = '<div class="dash-section">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
    html += '<div style="display:flex;align-items:baseline;gap:12px">';
    html += '<span style="font-size:32px;font-weight:800;color:' + ddayColor + ';font-family:\'SF Mono\',monospace">' + ddayText + '</span>';
    html += '<span style="font-size:24px;font-weight:700;color:' + T.text() + ';font-family:\'SF Mono\',monospace">' + s.pct + '%</span>';
    html += '</div>';

    if (!editingDate) {
        html += '<button id="launch-date-edit-btn" class="launch-icon-btn" title="' + t('launch.changeDate') + '">' + escapeHtml(s.targetDate) + ' ' + icon('pencil', 12) + '</button>';
    }
    html += '</div>';

    // Progress bar
    html += '<div class="usage-bar-bg"><div class="usage-bar-fill" style="width:' + s.pct + '%;background:' + barColor + '"></div></div>';

    // Stats row
    html += '<div style="display:flex;gap:4px;margin-top:8px;font-size:11px;color:' + T.textSubtle() + ';font-family:\'SF Mono\',monospace">';
    html += '<span>' + t('launch.done', { n: s.done + '/' + s.total }) + '</span>';
    html += '<span style="flex:1"></span>';
    if (s.blockers > 0) {
        html += '<span style="color:' + T.danger() + '">' + t('launch.blockerCount', { n: s.blockers }) + '</span>';
    }
    html += '</div>';

    // Date edit form
    if (editingDate) {
        html += renderDateEditForm(s.targetDate);
    }

    html += '</div>';
    return html;
}

function renderDateEditForm(currentDate) {
    return '<div class="launch-date-form" style="margin-top:12px;padding:12px;background:' + T.bgDeep() + ';border-radius:8px;border:1px solid ' + T.border() + '">' +
        '<div style="font-size:12px;color:' + T.textMuted() + ';margin-bottom:8px">' + t('launch.changeDateTitle') + '</div>' +
        '<input type="date" id="launch-new-date" value="' + currentDate + '" style="width:100%;padding:8px;background:' + T.bgRaised() + ';color:' + T.text() + ';border:1px solid ' + T.border() + ';border-radius:6px;font-size:14px;margin-bottom:8px">' +
        '<input type="text" id="launch-date-reason" placeholder="' + t('launch.changeDateReason') + '" style="width:100%;padding:8px;background:' + T.bgRaised() + ';color:' + T.text() + ';border:1px solid ' + T.border() + ';border-radius:6px;font-size:13px;margin-bottom:8px">' +
        '<div style="display:flex;gap:8px">' +
        '<button id="launch-date-save" class="launch-btn launch-btn-primary" style="flex:1">' + t('common.save') + '</button>' +
        '<button id="launch-date-cancel" class="launch-btn" style="flex:1">' + t('common.cancel') + '</button>' +
        '</div></div>';
}

function renderSubTabs() {
    var ov = subView === 'overview' ? ' active' : '';
    var cl = subView === 'checklist' ? ' active' : '';
    return '<div class="launch-tabs">' +
        '<button class="launch-tab' + ov + '" data-sub="overview">' + t('launch.overview') + '</button>' +
        '<button class="launch-tab' + cl + '" data-sub="checklist">' + t('launch.checklist') + '</button>' +
        '</div>';
}

function renderOverview() {
    if (!status) return '';
    var html = '';

    // Priority cards
    var prios = status.priorities || [];
    html += '<div class="launch-prio-grid">';
    prios.forEach(function(p) {
        var c = PRIO_COLORS[p.priority] || PRIO_COLORS['P3'];
        var pDone = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
        html += '<div class="launch-prio-card" style="background:' + c.bg + '">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
        html += '<span style="font-size:11px;font-weight:700;color:' + c.text + ';font-family:\'SF Mono\',monospace">' + p.priority + '</span>';
        html += '<span style="font-size:10px;color:' + T.textSubtle() + '">' + t(c.labelKey) + '</span>';
        html += '</div>';
        html += '<div style="font-size:20px;font-weight:700;color:' + c.text + ';font-family:\'SF Mono\',monospace">' + p.done + '<small style="font-size:12px;color:' + T.textSubtle() + '">/' + p.total + '</small></div>';
        html += '<div class="usage-bar-bg" style="margin-top:6px;height:4px"><div class="usage-bar-fill" style="width:' + pDone + '%;background:' + c.text + ';height:100%"></div></div>';
        html += '</div>';
    });
    html += '</div>';

    // Undone P0 items (blockers)
    var blockers = items.filter(function(it) { return !it.done && it.priority === 'P0'; });
    if (blockers.length > 0) {
        html += '<div class="dash-section">';
        html += '<div class="dash-section-title"><span style="color:' + T.danger() + '">' + icon('alertTriangle', 16) + '</span> ' + t('launch.blockers') + '</div>';
        blockers.forEach(function(it) {
            html += renderItemRow(it);
        });
        html += '</div>';
    }

    // This week's tasks (undone, sorted by priority)
    var undone = items.filter(function(it) { return !it.done; });
    undone.sort(function(a, b) {
        var pa = a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0;
        if (pa !== 0) return pa;
        return a.week - b.week;
    });
    var upcoming = undone.slice(0, 10);
    if (upcoming.length > 0) {
        html += '<div class="dash-section">';
        html += '<div class="dash-section-title"><span style="color:' + T.accent() + '">' + icon('clipboardList', 16) + '</span> ' + t('launch.nextTodo') + '</div>';
        upcoming.forEach(function(it) {
            html += renderItemRow(it);
        });
        html += '</div>';
    }

    // Recently completed
    var completed = items.filter(function(it) { return it.done; });
    completed.sort(function(a, b) { return (b.doneAt || b.updatedAt) - (a.doneAt || a.updatedAt); });
    var recent = completed.slice(0, 5);
    if (recent.length > 0) {
        html += '<div class="dash-section">';
        html += '<div class="dash-section-title"><span style="color:' + T.successText() + '">' + icon('checkCircle', 16) + '</span> ' + t('launch.recentDone') + '</div>';
        recent.forEach(function(it) {
            html += renderItemRow(it);
        });
        html += '</div>';
    }

    return html;
}

function renderChecklist() {
    var html = '';

    // Group by area
    var areaMap = {};
    items.forEach(function(it) {
        if (!areaMap[it.area]) areaMap[it.area] = { label: it.areaLabel, items: [] };
        areaMap[it.area].items.push(it);
    });

    AREAS.forEach(function(a) {
        var group = areaMap[a.key];
        if (!group) return;

        var done = group.items.filter(function(it) { return it.done; }).length;
        var total = group.items.length;
        var expanded = expandedAreas[a.key] !== false; // default expanded
        var arrow = expanded ? I.chevronDown : I.chevronRight;

        html += '<div class="dash-section" style="padding-bottom:0">';
        html += '<div class="launch-area-hdr" data-area="' + a.key + '">';
        html += '<span style="display:inline-flex;color:' + T.textMuted() + '">' + a.icon + '</span>';
        html += '<span style="flex:1;font-size:13px;font-weight:600;color:' + T.text() + '">' + escapeHtml(group.label) + '</span>';
        html += '<span style="font-size:12px;color:' + (done === total ? T.successText() : T.textMuted()) + ';font-family:\'SF Mono\',monospace">' + done + '/' + total + '</span>';
        html += '<span style="display:inline-flex;color:' + T.textSubtle() + ';margin-left:8px">' + arrow + '</span>';
        html += '</div>';

        if (expanded) {
            // Sort: undone first, then by priority
            var sorted = group.items.slice().sort(function(a, b) {
                if (a.done !== b.done) return a.done ? 1 : -1;
                return a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0;
            });
            sorted.forEach(function(it) {
                html += renderItemRow(it);
            });
        }
        html += '</div>';
    });

    // Add item button
    html += '<div class="dash-section" style="text-align:center;padding:24px">';
    html += '<button id="launch-add-btn" class="launch-btn">' + t('launch.addItem') + '</button>';
    html += '</div>';

    return html;
}

function renderItemRow(it) {
    var c = PRIO_COLORS[it.priority] || PRIO_COLORS['P3'];
    var checked = it.done ? ' checked' : '';
    var textStyle = it.done ? 'text-decoration:line-through;color:' + T.textSubtle() : 'color:' + T.text();

    var html = '<div class="launch-item">';
    html += '<input type="checkbox" class="launch-cb" data-id="' + it.id + '"' + checked + '>';
    html += '<span style="font-size:13px;flex:1;' + textStyle + '">' + escapeHtml(it.title) + '</span>';
    html += '<span class="launch-prio-badge" style="background:' + c.bg + ';color:' + c.text + '">' + it.priority + '</span>';
    html += '<button class="launch-del-btn" data-id="' + it.id + '" title="' + t('common.delete') + '">' + icon('x', 12) + '</button>';
    html += '</div>';
    return html;
}

// --- Events ---
function bindEvents() {
    // Sub-tab switching
    contentEl.querySelectorAll('.launch-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            subView = tab.dataset.sub;
            render();
        });
    });

    // Checkbox toggle
    contentEl.querySelectorAll('.launch-cb').forEach(function(cb) {
        cb.addEventListener('change', function() {
            var id = cb.dataset.id;
            fetch('/api/launch/items/' + id, {
                method: 'PATCH', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: cb.checked })
            }).then(function() {
                lastLoad = 0;
                loadLaunch();
            });
        });
    });

    // Delete button
    contentEl.querySelectorAll('.launch-del-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = btn.dataset.id;
            showConfirm(t('launch.deleteConfirm'), [
                { label: t('common.delete'), style: 'primary', action: function() {
                    fetch('/api/launch/items/' + id, {
                        method: 'DELETE', credentials: 'same-origin'
                    }).then(function() { lastLoad = 0; loadLaunch(); });
                }},
                { label: t('common.cancel'), style: 'cancel' }
            ]);
        });
    });

    // Area collapse/expand
    contentEl.querySelectorAll('.launch-area-hdr').forEach(function(hdr) {
        hdr.addEventListener('click', function() {
            var area = hdr.dataset.area;
            expandedAreas[area] = expandedAreas[area] === false ? true : false;
            render();
        });
    });

    // Date edit button
    var dateBtn = document.getElementById('launch-date-edit-btn');
    if (dateBtn) {
        dateBtn.addEventListener('click', function() {
            editingDate = true;
            render();
        });
    }

    // Date save/cancel
    var dateSave = document.getElementById('launch-date-save');
    if (dateSave) {
        dateSave.addEventListener('click', function() {
            var newDate = document.getElementById('launch-new-date').value;
            var reason = document.getElementById('launch-date-reason').value;
            if (!newDate) return;

            showConfirm(t('launch.changeDateConfirm', { date: newDate }), [
                { label: t('common.confirm'), style: 'primary', action: function() {
                    fetch('/api/launch/config', {
                        method: 'PUT', credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ targetDate: newDate, reason: reason })
                    }).then(function() {
                        editingDate = false;
                        lastLoad = 0;
                        loadLaunch();
                        showToast(t('launch.dateChanged'));
                    });
                }},
                { label: t('common.cancel'), style: 'cancel' }
            ]);
        });
    }
    var dateCancel = document.getElementById('launch-date-cancel');
    if (dateCancel) {
        dateCancel.addEventListener('click', function() {
            editingDate = false;
            render();
        });
    }

    // Add item button
    var addBtn = document.getElementById('launch-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', showAddForm);
    }
}

function bindSeedBtn() {
    var btn = document.getElementById('launch-seed-btn');
    if (btn) {
        btn.addEventListener('click', function() {
            btn.disabled = true;
            btn.textContent = t('launch.initializing');
            fetch('/api/launch/seed', {
                method: 'POST', credentials: 'same-origin'
            }).then(function() {
                lastLoad = 0;
                loadLaunch();
                showToast(t('launch.initialized'));
            });
        });
    }
}

function showAddForm() {
    var areaOptions = AREAS.map(function(a) {
        return '<option value="' + a.key + '">' + a.icon + ' ' + a.key + '</option>';
    }).join('');

    var formHtml = '<div class="dash-section" id="launch-add-form-wrap" style="padding:16px">' +
        '<div style="font-size:13px;font-weight:600;color:' + T.text() + ';margin-bottom:12px">' + t('launch.addItemTitle') + '</div>' +
        '<input type="text" id="launch-add-title" placeholder="' + t('launch.addItemPlaceholder') + '" style="width:100%;padding:8px;background:' + T.bgRaised() + ';color:' + T.text() + ';border:1px solid ' + T.border() + ';border-radius:6px;font-size:13px;margin-bottom:8px">' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
        '<select id="launch-add-area" style="flex:1;padding:8px;background:' + T.bgRaised() + ';color:' + T.text() + ';border:1px solid ' + T.border() + ';border-radius:6px;font-size:13px">' + areaOptions + '</select>' +
        '<select id="launch-add-prio" style="width:70px;padding:8px;background:' + T.bgRaised() + ';color:' + T.text() + ';border:1px solid ' + T.border() + ';border-radius:6px;font-size:13px">' +
        '<option value="P0">P0</option><option value="P1" selected>P1</option><option value="P2">P2</option><option value="P3">P3</option></select>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
        '<button id="launch-add-save" class="launch-btn launch-btn-primary" style="flex:1">' + t('launch.add') + '</button>' +
        '<button id="launch-add-cancel" class="launch-btn" style="flex:1">' + t('common.cancel') + '</button>' +
        '</div></div>';

    // Replace the add button section
    var addBtnSection = document.getElementById('launch-add-btn');
    if (addBtnSection) {
        addBtnSection.parentElement.outerHTML = formHtml;
    }

    // Bind form events
    var saveBtn = document.getElementById('launch-add-save');
    var cancelBtn = document.getElementById('launch-add-cancel');

    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            var title = document.getElementById('launch-add-title').value.trim();
            var area = document.getElementById('launch-add-area').value;
            var priority = document.getElementById('launch-add-prio').value;
            if (!title) { showToast(t('launch.enterTitle')); return; }

            // Find area label
            var areaLabel = area;
            items.forEach(function(it) {
                if (it.area === area) areaLabel = it.areaLabel;
            });

            fetch('/api/launch/items', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title, area: area, areaLabel: areaLabel, priority: priority })
            }).then(function() {
                lastLoad = 0;
                loadLaunch();
                showToast(t('launch.itemAdded'));
            });
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() { render(); });
    }

    // Focus title input
    var titleInput = document.getElementById('launch-add-title');
    if (titleInput) titleInput.focus();
}
