// Settings Bottom Sheet — ES module
import { showConfirm, closeConfirm, showToast } from './utils.js';
import { disableEdgeZones, enableEdgeZones } from './gestures.js';
import { t, setLocale, getLocale, translateDOM } from './i18n.js';

var shSettings = { general: { wakeLock: false, fontSize: 16, notification: false }, snippets: [] };

// ─── Push Subscription ──────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

function subscribePush() {
    return navigator.serviceWorker.ready.then(function(reg) {
        return fetch('/api/push/vapid-key', { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                return reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(data.publicKey)
                });
            })
            .then(function(subscription) {
                return fetch('/api/push/subscribe', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(subscription.toJSON())
                }).then(function() { return true; });
            });
    }).catch(function(err) {
        console.error('[push] subscribe failed:', err);
        return false;
    });
}

function unsubscribePush() {
    navigator.serviceWorker.ready.then(function(reg) {
        return reg.pushManager.getSubscription();
    }).then(function(sub) {
        if (!sub) return;
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function() {
            return fetch('/api/push/subscribe', {
                method: 'DELETE', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: endpoint })
            });
        });
    }).catch(function(err) {
        console.error('[push] unsubscribe failed:', err);
    });
}

function _cv(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function getSHColors() {
    return {
        'default': _cv('--text-subtle'),
        'green':   _cv('--success'),
        'blue':    _cv('--accent'),
        'red':     _cv('--danger'),
        'yellow':  '#f9e2af',
        'purple':  '#cba6f7',
        'teal':    _cv('--success')
    };
}
var SH_COLORS = getSHColors();
var SH_COLOR_NAMES = Object.keys(SH_COLORS);

var shDragSrcIdx = null;
var shTouchState = null;
var _callbacks = { onSave: function() {}, onLogout: function() {} };

function escAttr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// --- Settings value binding ---
function applySettingsToSheet() {
    document.getElementById('sh-wakeLock').checked = shSettings.general.wakeLock;
    document.getElementById('sh-fontVal').textContent = shSettings.general.fontSize || 16;
    document.getElementById('sh-termFontVal').textContent = shSettings.general.termFontSize || 15;
    document.getElementById('sh-notification').checked = !!shSettings.general.notification;
    var langSelect = document.getElementById('sh-language');
    if (langSelect) langSelect.value = shSettings.general.language || getLocale();
}

// --- Snippet rendering ---
function renderSettingsSnippets() {
    var list = document.getElementById('sh-snippet-list');
    list.innerHTML = '';
    (shSettings.snippets || []).forEach(function(sn, i) {
        var card = document.createElement('div');
        card.className = 'sn-card' + (sn.hidden ? ' hidden' : '');
        card.draggable = true;
        card.dataset.idx = i;

        var colorHtml = SH_COLOR_NAMES.map(function(c) {
            return '<div class="sn-color-opt' + (sn.color === c ? ' selected' : '') +
                '" style="background:' + SH_COLORS[c] + '" data-color="' + c + '"></div>';
        }).join('');

        var displayLabel = sn.label || t('notes.untitled');
        var labelClass = sn.label ? 'sn-header-label' : 'sn-header-label empty';
        var dotColor = SH_COLORS[sn.color] || SH_COLORS['default'];
        var cmdPreview = sn.command ? sn.command.split('\n')[0] : '';
        if (cmdPreview.length > 30) cmdPreview = cmdPreview.substring(0, 30) + '…';

        var visIcon = sn.hidden ? '&#x1F6AB;' : '&#x1F441;';
        card.innerHTML =
            '<div class="sn-header">' +
                '<span class="sn-handle">&#x2630;</span>' +
                '<button class="sn-visibility" data-action="toggle-visibility">' + visIcon + '</button>' +
                '<div class="sn-color-dot" style="background:' + dotColor + '"></div>' +
                '<span class="' + labelClass + '">' + escHtml(displayLabel) + '</span>' +
                '<span class="sn-header-cmd">' + escHtml(cmdPreview) + '</span>' +
                '<span class="sn-chevron">&#x25B6;</span>' +
            '</div>' +
            '<div class="sn-body">' +
                '<div class="sn-top">' +
                    '<input type="text" value="' + escAttr(sn.label) + '" placeholder="Label" data-field="label">' +
                    '<button class="sn-del" data-action="delete">&times;</button>' +
                '</div>' +
                '<div class="sn-field">' +
                    '<div class="sn-field-label">Command</div>' +
                    '<textarea rows="1" data-field="command" placeholder="command...">' + escHtml(sn.command) + '</textarea>' +
                '</div>' +
                '<div class="sn-field">' +
                    '<div class="sn-field-label">Color</div>' +
                    '<div class="sn-colors" data-field="color">' + colorHtml + '</div>' +
                '</div>' +
                '<div class="sn-field">' +
                    '<div class="sn-opts-row">' +
                        '<div class="sn-opt-item">' +
                            '<span>' + t('settings.confirmLabel') + '</span>' +
                            '<label class="sn-mini-toggle">' +
                                '<input type="checkbox"' + (sn.confirm ? ' checked' : '') + ' data-field="confirm">' +
                                '<div class="mt-track"></div>' +
                                '<div class="mt-thumb"></div>' +
                            '</label>' +
                        '</div>' +
                        '<div class="sn-opt-item">' +
                            '<span>' + t('settings.newWindowLabel') + '</span>' +
                            '<label class="sn-mini-toggle">' +
                                '<input type="checkbox"' + (sn.newWindow ? ' checked' : '') + ' data-field="newWindow">' +
                                '<div class="mt-track"></div>' +
                                '<div class="mt-thumb"></div>' +
                            '</label>' +
                        '</div>' +
                        '<div class="sn-opt-item">' +
                            '<span>' + t('settings.hiddenLabel') + '</span>' +
                            '<label class="sn-mini-toggle">' +
                                '<input type="checkbox"' + (sn.hidden ? ' checked' : '') + ' data-field="hidden">' +
                                '<div class="mt-track"></div>' +
                                '<div class="mt-thumb"></div>' +
                            '</label>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        // Accordion toggle (suppress during drag)
        var header = card.querySelector('.sn-header');
        var wasDragged = false;
        card.addEventListener('dragstart', function() { wasDragged = true; });
        card.addEventListener('dragend', function() { setTimeout(function() { wasDragged = false; }, 0); });
        header.addEventListener('click', function(e) {
            if (e.target.closest('.sn-handle')) return;
            if (wasDragged) return;
            card.classList.toggle('expanded');
            if (card.classList.contains('expanded')) {
                var ta2 = card.querySelector('textarea');
                if (ta2) { ta2.style.height = 'auto'; ta2.style.height = ta2.scrollHeight + 'px'; }
            }
        });

        // Auto-resize textarea
        var ta = card.querySelector('textarea[data-field="command"]');
        ta.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });

        // Field changes
        card.addEventListener('input', function(e) {
            var el = e.target; var field = el.dataset.field;
            if (!field) return;
            if (field === 'label') {
                shSettings.snippets[i].label = el.value;
                var hl = card.querySelector('.sn-header-label');
                hl.textContent = el.value || 'Untitled';
                hl.className = el.value ? 'sn-header-label' : 'sn-header-label empty';
            }
            else if (field === 'command') {
                shSettings.snippets[i].command = el.value;
                var hc = card.querySelector('.sn-header-cmd');
                var preview = el.value ? el.value.split('\n')[0] : '';
                if (preview.length > 30) preview = preview.substring(0, 30) + '\u2026';
                hc.textContent = preview;
            }
            else if (field === 'confirm') shSettings.snippets[i].confirm = el.checked;
            else if (field === 'newWindow') shSettings.snippets[i].newWindow = el.checked;
            else if (field === 'hidden') {
                shSettings.snippets[i].hidden = el.checked;
                card.classList.toggle('hidden', el.checked);
                var visBtn = card.querySelector('.sn-visibility');
                if (visBtn) visBtn.innerHTML = el.checked ? '&#x1F6AB;' : '&#x1F441;';
            }
        });

        // Click delegation (delete, color)
        card.addEventListener('click', function(e) {
            var t = e.target;
            if (t.dataset.action === 'delete') {
                shSettings.snippets.splice(i, 1);
                renderSettingsSnippets();
            }
            if (t.dataset.action === 'toggle-visibility') {
                e.stopPropagation();
                shSettings.snippets[i].hidden = !shSettings.snippets[i].hidden;
                var isHidden = shSettings.snippets[i].hidden;
                card.classList.toggle('hidden', isHidden);
                t.innerHTML = isHidden ? '&#x1F6AB;' : '&#x1F441;';
                var hiddenCheckbox = card.querySelector('input[data-field="hidden"]');
                if (hiddenCheckbox) hiddenCheckbox.checked = isHidden;
            }
            if (t.dataset.color !== undefined) {
                shSettings.snippets[i].color = t.dataset.color;
                t.parentElement.querySelectorAll('.sn-color-opt').forEach(function(o) { o.classList.remove('selected'); });
                t.classList.add('selected');
                var dot = card.querySelector('.sn-color-dot');
                if (dot) dot.style.background = SH_COLORS[t.dataset.color] || SH_COLORS['default'];
            }
        });

        // Desktop drag
        card.addEventListener('dragstart', function(e) {
            shDragSrcIdx = i;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragover', function(e) {
            if (shDragSrcIdx === null || shDragSrcIdx === i) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', function() { card.classList.remove('drag-over'); });
        card.addEventListener('drop', function(e) {
            e.preventDefault();
            card.classList.remove('drag-over');
            if (shDragSrcIdx === null || shDragSrcIdx === i) return;
            var moved = shSettings.snippets.splice(shDragSrcIdx, 1)[0];
            shSettings.snippets.splice(i, 0, moved);
            shDragSrcIdx = null;
            renderSettingsSnippets();
        });
        card.addEventListener('dragend', function() { card.classList.remove('dragging'); shDragSrcIdx = null; });

        // Mobile touch drag (handle is in header)
        var handle = card.querySelector('.sn-handle');
        handle.addEventListener('touchstart', function(e) {
            e.preventDefault();
            var touch = e.touches[0];
            var rect = card.getBoundingClientRect();
            shTouchState = { idx: i, card: card, offsetY: touch.clientY - rect.top, clone: null };
            card.classList.add('dragging');

            var clone = card.cloneNode(true);
            clone.style.cssText = 'position:fixed;left:16px;right:16px;width:' + rect.width + 'px;z-index:200;pointer-events:none;opacity:0.8;';
            clone.style.top = rect.top + 'px';
            document.body.appendChild(clone);
            shTouchState.clone = clone;

            document.addEventListener('touchmove', shOnTouchMove, { passive: false });
            document.addEventListener('touchend', shOnTouchEnd);
        }, { passive: false });

        list.appendChild(card);
    });
}

// --- Touch drag handlers ---
function shOnTouchMove(e) {
    if (!shTouchState) return;
    e.preventDefault();
    var y = e.touches[0].clientY;
    shTouchState.clone.style.top = (y - shTouchState.offsetY) + 'px';
    document.querySelectorAll('.sn-card').forEach(function(c, ci) {
        var r = c.getBoundingClientRect();
        if (y > r.top && y < r.bottom && ci !== shTouchState.idx) {
            c.classList.add('drag-over');
        } else {
            c.classList.remove('drag-over');
        }
    });
}

function shOnTouchEnd(e) {
    if (!shTouchState) return;
    document.removeEventListener('touchmove', shOnTouchMove);
    document.removeEventListener('touchend', shOnTouchEnd);
    if (shTouchState.clone) shTouchState.clone.remove();

    var y = e.changedTouches[0].clientY;
    var targetIdx = -1;
    document.querySelectorAll('.sn-card').forEach(function(c, ci) {
        var r = c.getBoundingClientRect();
        if (y > r.top && y < r.bottom && ci !== shTouchState.idx) targetIdx = ci;
        c.classList.remove('drag-over');
    });

    shTouchState.card.classList.remove('dragging');
    if (targetIdx >= 0 && targetIdx !== shTouchState.idx) {
        var moved = shSettings.snippets.splice(shTouchState.idx, 1)[0];
        shSettings.snippets.splice(targetIdx, 0, moved);
        renderSettingsSnippets();
    }
    shTouchState = null;
}

// --- Open / Close ---
function openSettings() {
    fetch('/api/settings')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            shSettings = data;
            applySettingsToSheet();
            renderSettingsSnippets();
        })
        .catch(function() {
            applySettingsToSheet();
            renderSettingsSnippets();
        });
    var shBackdrop = document.getElementById('settings-backdrop');
    var shSheet = document.getElementById('settings-sheet');
    shBackdrop.classList.add('open');
    shSheet.classList.add('open');
    document.body.style.overflow = 'hidden';
    disableEdgeZones();
}

function closeSettings() {
    var shBackdrop = document.getElementById('settings-backdrop');
    var shSheet = document.getElementById('settings-sheet');
    shBackdrop.classList.remove('open');
    shSheet.classList.remove('open');
    document.body.style.overflow = '';
    enableEdgeZones();
}

// --- Init ---
function initSettings(callbacks) {
    _callbacks = callbacks || _callbacks;

    var shBackdrop = document.getElementById('settings-backdrop');
    var shSheet = document.getElementById('settings-sheet');
    var shHeader = document.getElementById('sheet-header');
    var shClose = document.getElementById('sheet-close');
    var settingsBtn = document.getElementById('settings-btn');

    // Open trigger
    settingsBtn.addEventListener('click', function(e) {
        e.preventDefault();
        openSettings();
    });

    // Close triggers
    shBackdrop.addEventListener('click', closeSettings);
    shClose.addEventListener('click', closeSettings);
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && shSheet.classList.contains('open')) {
            closeSettings();
        }
    });

    // --- Swipe to dismiss ---
    var shSwipeStartY = 0;
    var shSwipeDy = 0;
    var shSwipeActive = false;

    shHeader.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) return;
        shSwipeStartY = e.touches[0].clientY;
        shSwipeDy = 0;
        shSwipeActive = true;
        shSheet.classList.add('dragging');
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
        if (!shSwipeActive) return;
        var dy = e.touches[0].clientY - shSwipeStartY;
        if (dy < 0) dy = 0;
        shSwipeDy = dy;
        shSheet.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (!shSwipeActive) return;
        shSwipeActive = false;
        shSheet.classList.remove('dragging');
        shSheet.style.transform = '';
        var sheetH = shSheet.offsetHeight;
        if (shSwipeDy > sheetH * 0.3) {
            closeSettings();
        }
    }, { passive: true });

    // --- General settings controls ---
    document.getElementById('sh-termfont-minus').addEventListener('click', function() {
        var v = (shSettings.general.termFontSize || 15) - 1;
        if (v >= 8) { shSettings.general.termFontSize = v; document.getElementById('sh-termFontVal').textContent = v; }
    });
    document.getElementById('sh-termfont-plus').addEventListener('click', function() {
        var v = (shSettings.general.termFontSize || 15) + 1;
        if (v <= 24) { shSettings.general.termFontSize = v; document.getElementById('sh-termFontVal').textContent = v; }
    });

    document.getElementById('sh-font-minus').addEventListener('click', function() {
        var v = (shSettings.general.fontSize || 16) - 1;
        if (v >= 10) { shSettings.general.fontSize = v; document.getElementById('sh-fontVal').textContent = v; }
    });
    document.getElementById('sh-font-plus').addEventListener('click', function() {
        var v = (shSettings.general.fontSize || 16) + 1;
        if (v <= 28) { shSettings.general.fontSize = v; document.getElementById('sh-fontVal').textContent = v; }
    });

    document.getElementById('sh-wakeLock').addEventListener('change', function() {
        shSettings.general.wakeLock = this.checked;
    });

    document.getElementById('sh-notification').addEventListener('change', function() {
        var toggle = this;
        if (toggle.checked) {
            if (!('Notification' in window) || !('PushManager' in window)) {
                toggle.checked = false;
                showToast(t('settings.pushNotSupported'));
                return;
            }
            Notification.requestPermission().then(function(perm) {
                if (perm === 'granted') {
                    subscribePush().then(function(ok) {
                        if (ok) {
                            shSettings.general.notification = true;
                            showToast(t('settings.pushEnabled'));
                        } else {
                            toggle.checked = false;
                            shSettings.general.notification = false;
                            showToast(t('settings.pushFailed'));
                        }
                    });
                } else {
                    toggle.checked = false;
                    shSettings.general.notification = false;
                    showToast(t('settings.pushDenied'));
                }
            });
        } else {
            shSettings.general.notification = false;
            unsubscribePush();
        }
    });

    // --- Language ---
    var langSelect = document.getElementById('sh-language');
    if (langSelect) {
        langSelect.addEventListener('change', function() {
            shSettings.general.language = this.value;
        });
    }

    // --- Add snippet ---
    document.getElementById('sh-add-snippet').addEventListener('click', function() {
        shSettings.snippets.push({
            id: 's' + Date.now(),
            label: '',
            command: '',
            color: 'default',
            confirm: false
        });
        renderSettingsSnippets();
        var cards = document.querySelectorAll('.sn-card');
        var last = cards[cards.length - 1];
        if (last) {
            last.classList.add('expanded');
            last.querySelector('input[data-field="label"]').focus();
            last.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // --- Save ---
    document.getElementById('sh-save-btn').addEventListener('click', function() {
        var btn = this;
        btn.textContent = t('common.saving');
        btn.disabled = true;

        fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(shSettings)
        })
        .then(function(r) { return r.json(); })
        .then(function() {
            // Apply language change
            var newLang = shSettings.general.language;
            if (newLang && newLang !== getLocale()) {
                setLocale(newLang).then(function() {
                    translateDOM();
                    document.documentElement.lang = newLang;
                });
            }
            if (_callbacks.onSave) _callbacks.onSave(shSettings);

            btn.textContent = t('common.saved');
            btn.classList.add('saved');
            setTimeout(function() {
                btn.textContent = t('common.save');
                btn.classList.remove('saved');
                btn.disabled = false;
            }, 1500);
        })
        .catch(function() {
            btn.textContent = t('common.error');
            btn.disabled = false;
            setTimeout(function() { btn.textContent = t('common.save'); }, 2000);
        });
    });

    // --- Logout ---
    document.getElementById('sh-logout').addEventListener('click', function() {
        showConfirm(t('settings.logoutConfirm'), [
            { label: t('common.logout'), style: 'primary', action: function() {
                fetch('/api/auth/logout', { method: 'POST' })
                    .then(function() { if (_callbacks.onLogout) _callbacks.onLogout(); })
                    .catch(function() { if (_callbacks.onLogout) _callbacks.onLogout(); });
            }},
            { label: t('common.cancel'), style: 'cancel' }
        ]);
    });
}

export { initSettings, openSettings, closeSettings, subscribePush };
