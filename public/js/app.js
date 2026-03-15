// app.js — Main entry point (ES module)
// Orchestrates all modules, view switching, event bindings, and initialization.

import { initAuth } from './auth.js';
import { initTerminal, getTA, sendText, sendKey, tmuxCmd, uploadFile, submitInput, getTtydUrl, updateSettings as updateTermSettings, openSendHistory, closeSendHistory } from './terminal.js';
import { initPolling, startUsagePolling, stopUsagePolling, startServerPolling, stopServerPolling, startNotifyPolling, stopNotifyPolling, fetchClaudeUsage, fetchServerStatus, fetchTmuxSession, setNotifyEnabled } from './polling.js';
import { initPreview, navigateActiveTab } from './preview.js';
import { initNotes, loadNotesList, setViewSwitcher as setNotesViewSwitcher } from './notes.js';
import { initBrain, loadBrainTree, setViewSwitcher as setBrainViewSwitcher } from './brain.js';
import { initDash, loadDashboard } from './dash.js';
import { initLaunch, loadLaunch } from './launch.js';
import { initFiles, loadFiles } from './files.js';
import { initMonitor, loadMonitor, startMonitorPolling, stopMonitorPolling } from './monitoring.js';
import { initSettings, openSettings, subscribePush } from './settings.js';
import { quickCopy, invalidateCellSize, prefetchTerminalText } from './copy-mode.js';
import { initGestures, setupPullToRefresh, initTabDragDrop, initTouchScroll } from './gestures.js';
import { renderSnippets } from './snippets.js';
import { showToast, showConfirm, closeConfirm, isMobile, escapeHtml } from './utils.js';
import { initI18n, t, translateDOM } from './i18n.js';
import { I, icon } from './icons.js';

// --- Make showToast globally available (used by some modules) ---
window.showToast = showToast;

// ========================================
// State
// ========================================
var activeView = 'terminal';
var notesListLoaded = false;

// ========================================
// DOM references (resolved after DOMContentLoaded / inline)
// ========================================
var viewTabs;
var viewTabsBar;
var terminalFrame;
var previewContainer;
var notesContainer;
var notesListView;
var notesEditorView;
var brainContainer;
var brainTreeView;
var brainEditorView;
var dashContainer;
var launchContainer;
var filesContainer;
var monitorContainer;
var scrollIndicatorEl;
var scrollBottomBtnEl;
var toolbarEl;
var keysBarEl;
var inputBarEl;
var frame;
var textInput;

// ========================================
// View Switching
// ========================================
function switchView(view) {
    activeView = view;
    var isTerm = view === 'terminal';
    var isNotes = view === 'notes';
    var isBrain = view === 'brain';
    var isDash = view === 'dash';
    var isLaunch = view === 'launch';
    var isFiles = view === 'files';
    var isMonitor = view === 'monitor';

    viewTabs.forEach(function(tab) {
        tab.classList.toggle('active', tab.dataset.view === view);
    });

    terminalFrame.style.display = isTerm ? 'block' : 'none';
    previewContainer.style.display = view === 'preview' ? 'flex' : 'none';
    notesContainer.style.display = isNotes ? 'flex' : 'none';
    brainContainer.style.display = isBrain ? 'flex' : 'none';
    dashContainer.style.display = isDash ? 'flex' : 'none';
    launchContainer.style.display = isLaunch ? 'flex' : 'none';
    filesContainer.style.display = isFiles ? 'flex' : 'none';
    monitorContainer.style.display = isMonitor ? 'flex' : 'none';

    // Hide all terminal-only chrome in non-terminal mode
    scrollIndicatorEl.style.display = isTerm ? '' : 'none';
    scrollBottomBtnEl.style.display = isTerm ? '' : 'none';
    toolbarEl.style.display = isTerm ? '' : 'none';
    keysBarEl.style.display = isTerm ? '' : 'none';
    inputBarEl.style.display = isTerm ? '' : 'none';

    if (isNotes) {
        notesEditorView.style.display = 'none';
        notesListView.style.display = 'flex';
        loadNotesList();
    }
    if (isBrain) {
        brainEditorView.style.display = 'none';
        brainTreeView.style.display = 'flex';
        loadBrainTree();
    }
    if (isDash) {
        loadDashboard();
    }
    if (isLaunch) {
        loadLaunch();
    }
    if (isFiles) {
        loadFiles();
    }
    if (isMonitor) {
        loadMonitor();
        startMonitorPolling();
    } else {
        stopMonitorPolling();
    }
}

// ========================================
// Tab Order (D&D)
// ========================================
function applyTabOrder(order) {
    if (!order || !order.length) return;
    var tabs = Array.from(viewTabsBar.querySelectorAll('.view-tab'));
    var tabMap = {};
    tabs.forEach(function(t) { tabMap[t.dataset.view] = t; });
    order.forEach(function(viewName) {
        if (tabMap[viewName]) viewTabsBar.appendChild(tabMap[viewName]);
    });
    // Append any tabs not in order (new tabs)
    tabs.forEach(function(t) {
        if (order.indexOf(t.dataset.view) === -1) viewTabsBar.appendChild(t);
    });
}

function saveTabOrder() {
    var order = Array.from(viewTabsBar.querySelectorAll('.view-tab')).map(function(t) {
        return t.dataset.view;
    });
    // Read current settings, update tabOrder, save
    fetch('/api/settings', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(settings) {
            settings.general = settings.general || {};
            settings.general.tabOrder = order;
            return fetch('/api/settings', {
                method: 'PUT', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
        });
}

// ========================================
// Apply General Settings
// ========================================
function applyGeneral(general) {
    // Input font size
    if (general.fontSize && general.fontSize !== 16) {
        textInput.style.fontSize = general.fontSize + 'px';
    }
    // Terminal font size — reload iframe if needed
    if (general.termFontSize && general.termFontSize !== 15) {
        var url = '/ttyd/?fontSize=' + general.termFontSize;
        if (frame.src.indexOf('fontSize=' + general.termFontSize) === -1) {
            invalidateCellSize();
            frame.src = url;
        }
    }
    // Wake Lock
    if (general.wakeLock && 'wakeLock' in navigator) {
        navigator.wakeLock.request('screen').catch(function() {});
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible' && general.wakeLock) {
                navigator.wakeLock.request('screen').catch(function() {});
            }
        });
    }
    // Notification polling + push re-subscribe
    if (general.notification) {
        setNotifyEnabled(true);
        startNotifyPolling();
        if ('PushManager' in window && Notification.permission === 'granted') {
            subscribePush();
        }
    } else {
        setNotifyEnabled(false);
        stopNotifyPolling();
    }
}

// ========================================
// Keys Map (toolbar + keys-bar)
// ========================================
var KEYS = {
    'ctrl-c':    function() { sendKey('c', 67, {ctrl: true}); },
    'ctrl-d':    function() { sendKey('d', 68, {ctrl: true}); },
    'enter':     function() { sendKey('Enter', 13); },
    'backspace': function() { sendKey('Backspace', 8); },
    'tab':       function() { sendKey('Tab', 9); },
    'up':        function() { sendKey('ArrowUp', 38); },
    'down':      function() { sendKey('ArrowDown', 40); },
    'left':      function() { sendKey('ArrowLeft', 37); },
    'right':     function() { sendKey('ArrowRight', 39); },
    'esc':       function() { sendKey('Escape', 27); },
    'space':     function() { sendText(' '); },
    'y':         function() { sendText('y'); },
    'n':         function() { sendText('n'); },
    'tmux-new':  function() { tmuxCmd('c', 67); },
    'tmux-prev': function() { tmuxCmd('p', 80); },
    'tmux-next': function() { tmuxCmd('n', 78); },
    'tmux-list': function() { tmuxCmd('w', 87); },
    'tmux-kill': function() {
        showConfirm(t('app.killConfirm'), [
            { label: t('app.killLabel'), style: 'primary', action: function() {
                tmuxCmd('&', 55);
                setTimeout(function() { sendText('y'); }, 200);
            }},
            { label: t('common.cancel'), style: 'cancel' }
        ]);
    }
};

// ========================================
// Plus Menu (image attach, file attach, memo operations)
// ========================================
function setupPlusMenu() {
    var plusMenu = document.getElementById('plus-menu');
    var imgBtn = document.getElementById('img-btn');
    var pmAttach = document.getElementById('pm-attach');
    var pmAttachFile = document.getElementById('pm-attach-file');
    var pmSaveMemo = document.getElementById('pm-save-memo');
    var pmMemoList = document.getElementById('pm-memo-list');
    var fileInput = document.getElementById('file-input');
    var fileInputAny = document.getElementById('file-input-any');
    var pmMemoCache = [];

    function autoResize() {
        textInput.style.height = 'auto';
        textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
    }

    // --- Migrate localStorage memos to Notes API (one-time) ---
    (function migrateLocalMemos() {
        var old = [];
        try { old = JSON.parse(localStorage.getItem('terminal-memos') || '[]'); } catch(e) {}
        if (!old.length) return;
        var pending = old.length;
        old.forEach(function(text) {
            var title = text.split('\n')[0].substring(0, 50) || t('app.memo');
            fetch('/api/notes', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title, content: text })
            }).then(function() {
                pending--;
                if (pending <= 0) {
                    localStorage.removeItem('terminal-memos');
                    notesListLoaded = false;
                }
            }).catch(function() { pending--; });
        });
    })();

    function fetchMemoList(cb) {
        fetch('/api/notes', { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                pmMemoCache = data.notes || [];
                if (cb) cb();
            })
            .catch(function() { if (cb) cb(); });
    }

    function renderMemos() {
        pmMemoList.innerHTML = '';
        if (pmMemoCache.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'pm-empty';
            empty.textContent = t('app.noMemos');
            pmMemoList.appendChild(empty);
            return;
        }
        pmMemoCache.forEach(function(note) {
            var row = document.createElement('div');
            row.className = 'pm-memo-item';
            if (note.pinned) {
                var pin = document.createElement('span');
                pin.className = 'pm-memo-pin';
                pin.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M5.5 2.5l5 1.5L9 7.5l2 5-7-4.5L7 5z"/></svg>';
                row.appendChild(pin);
            }
            var text = document.createElement('span');
            text.className = 'pm-memo-text';
            text.textContent = note.title || note.preview || t('notes.untitled');
            var del = document.createElement('button');
            del.className = 'pm-memo-del';
            del.innerHTML = icon('x', 12);
            function deleteMemo(e) {
                e.preventDefault();
                e.stopPropagation();
                closePlusMenu();
                showConfirm(t('notes.deleteConfirm'), [
                    { label: t('common.delete'), style: 'primary', action: function() {
                        fetch('/api/notes/' + note.id, { method: 'DELETE', credentials: 'same-origin' })
                            .then(function() { fetchMemoList(renderMemos); notesListLoaded = false; });
                    }},
                    { label: t('common.cancel'), style: 'cancel' }
                ]);
            }
            del.addEventListener('click', deleteMemo);
            row.addEventListener('click', function() {
                fetch('/api/notes/' + note.id, { credentials: 'same-origin' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        var memoContent = data.content || '';
                        closePlusMenu();

                        // Pinned memo: show content in modal
                        if (note.pinned) {
                            var msgEl = document.getElementById('confirm-msg');
                            var titleText = data.title || t('notes.untitled');
                            showConfirm('', [
                                { label: t('terminal.pasteToInput'), style: 'secondary', action: function() {
                                    pasteToInput(memoContent);
                                }},
                                { label: t('common.close'), style: 'cancel' }
                            ]);
                            msgEl.innerHTML = '<div class="memo-modal-title">' + escapeHtml(titleText) + '</div>' +
                                '<div class="memo-modal-content">' + escapeHtml(memoContent).replace(/\n/g, '<br>') + '</div>';
                            return;
                        }

                        // Normal memo: paste into input
                        var currentText = textInput.value.trim();
                        if (!currentText) {
                            pasteToInput(memoContent);
                            return;
                        }
                        showConfirm(t('app.inputHasContent'), [
                            { label: t('app.saveAndOverwrite'), style: 'primary', action: function() {
                                var saveTitle = currentText.split('\n')[0].substring(0, 50) || t('app.memo');
                                fetch('/api/notes', {
                                    method: 'POST', credentials: 'same-origin',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ title: saveTitle, content: currentText })
                                }).then(function() { notesListLoaded = false; });
                                pasteToInput(memoContent);
                            }},
                            { label: t('app.justOverwrite'), style: 'secondary', action: function() {
                                pasteToInput(memoContent);
                            }},
                            { label: t('common.cancel'), style: 'cancel' }
                        ]);
                    });
            });
            row.appendChild(text);
            row.appendChild(del);
            pmMemoList.appendChild(row);
        });
    }

    function pasteToInput(content) {
        textInput.value = content;
        autoResize();
        sessionStorage.setItem('terminal-input', textInput.value);
        textInput.focus();
    }

    function openPlusMenu() {
        pmMemoList.innerHTML = '<div class="pm-empty">' + t('common.loading') + '</div>';
        plusMenu.classList.add('open');
        fetchMemoList(renderMemos);
    }

    function closePlusMenu() {
        plusMenu.classList.remove('open');
    }

    function togglePlusMenu() {
        if (plusMenu.classList.contains('open')) {
            closePlusMenu();
        } else {
            openPlusMenu();
        }
    }

    imgBtn.addEventListener('click', function(e) {
        e.preventDefault();
        togglePlusMenu();
    });

    pmAttach.addEventListener('click', function() {
        closePlusMenu();
        fileInput.click();
    });

    pmAttachFile.addEventListener('click', function() {
        closePlusMenu();
        fileInputAny.click();
    });
    fileInput.addEventListener('change', function() {
        if (fileInput.files[0]) uploadFile(fileInput.files[0]);
        fileInput.value = '';
    });
    fileInputAny.addEventListener('change', function() {
        if (fileInputAny.files[0]) uploadFile(fileInputAny.files[0]);
        fileInputAny.value = '';
    });

    pmSaveMemo.addEventListener('click', function() {
        var text = textInput.value.trim();
        if (!text) return;
        var title = text.split('\n')[0].substring(0, 50) || t('app.memo');
        fetch('/api/notes', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title, content: text })
        }).then(function(res) {
            if (res.ok) {
                fetchMemoList(renderMemos);
                notesListLoaded = false;
                showToast(t('app.memoSaved'), 2000);
                textInput.value = '';
                textInput.style.height = '';
                textInput.style.lineHeight = '';
                textInput.style.padding = '';
                sessionStorage.removeItem('terminal-input');
                var clearBtn = document.getElementById('clear-input');
                if (clearBtn) clearBtn.classList.remove('visible');
            }
        });
        closePlusMenu();
    });

    // Close menu on outside click
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#plus-menu') && !e.target.closest('#img-btn')) {
            closePlusMenu();
        }
    });
    // Close menu on Escape (desktop keyboard UX)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && plusMenu.classList.contains('open')) {
            closePlusMenu();
        }
    });
}

// ========================================
// Toolbar Toggle
// ========================================
function setupToolbarToggle() {
    var toolbarToggle = document.getElementById('toolbar-toggle');
    var toolbar = document.getElementById('toolbar');
    var keysBar = document.getElementById('keys-bar');
    var toolbarsOpen = sessionStorage.getItem('toolbars-open') === '1';

    function setToolbars(open) {
        toolbarsOpen = open;
        toolbar.classList.toggle('hidden', !open);
        keysBar.classList.toggle('hidden', !open);
        toolbarToggle.innerHTML = open ? I.chevronDown : I.chevronUp;
        sessionStorage.setItem('toolbars-open', open ? '1' : '0');
    }
    setToolbars(toolbarsOpen);

    toolbarToggle.addEventListener('click', function(e) {
        e.preventDefault();
        setToolbars(!toolbarsOpen);
    });
}

// ========================================
// More Panel (bottom sheet with app icons)
// ========================================
function setupMorePanel() {
    var moreBtn = document.getElementById('more-btn');
    var morePanel = document.getElementById('more-panel');
    var moreGrid = morePanel.querySelector('.more-grid');
    var moreDoneBtn = document.getElementById('more-done-btn');
    var inputBar = document.getElementById('input-bar');
    var editMode = false;

    // --- Order persistence ---
    var ORDER_KEY = 'more-panel-order';
    function restoreOrder() {
        var saved = localStorage.getItem(ORDER_KEY);
        if (!saved) return;
        try {
            var ids = JSON.parse(saved);
            var items = Array.from(moreGrid.querySelectorAll('.more-item'));
            var map = {};
            items.forEach(function(el) { map[el.id] = el; });
            ids.forEach(function(id) {
                if (map[id]) moreGrid.appendChild(map[id]);
            });
        } catch(e) {}
    }
    function saveOrder() {
        var ids = Array.from(moreGrid.querySelectorAll('.more-item')).map(function(el) { return el.id; });
        localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    }
    restoreOrder();

    // --- Open / Close ---
    function openMore() {
        morePanel.classList.remove('hidden');
        inputBar.classList.add('more-open');
    }
    function closeMore() {
        morePanel.classList.add('hidden');
        inputBar.classList.remove('more-open');
        exitEditMode();
    }

    moreBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (morePanel.classList.contains('hidden')) {
            openMore();
        } else {
            closeMore();
        }
    });

    // --- Close panel on textarea focus (keyboard opens) ---
    textInput.addEventListener('focus', function() {
        if (!morePanel.classList.contains('hidden')) {
            closeMore();
        }
    });

    // --- Button actions ---
    var actions = {
        'more-settings': function() { openSettings(); },
        'more-history': function() { openSendHistory(); },
        'more-reload': function() { location.reload(); },
        'more-tmux-new': function() { KEYS['tmux-new'](); },
        'more-tmux-list': function() { KEYS['tmux-list'](); },
        'more-tmux-kill': function() { KEYS['tmux-kill'](); }
    };

    Object.keys(actions).forEach(function(id) {
        document.getElementById(id).addEventListener('click', function(e) {
            e.preventDefault();
            if (editMode) return;
            closeMore();
            actions[id]();
        });
    });

    // --- Edit mode (long-press reorder) ---
    var holdTimer = null;
    var HOLD_MS = 500;
    var dragging = false;
    var ghost = null;
    var draggedItem = null;
    var touchStartX = 0;
    var touchStartY = 0;

    function enterEditMode() {
        if (editMode) return;
        editMode = true;
        morePanel.classList.add('edit-mode');
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(30);
    }
    function exitEditMode() {
        if (!editMode) return;
        editMode = false;
        morePanel.classList.remove('edit-mode');
        _endDrag();
    }

    moreDoneBtn.addEventListener('click', function(e) {
        e.preventDefault();
        exitEditMode();
    });

    moreGrid.addEventListener('touchstart', function(e) {
        var item = e.target.closest('.more-item');
        if (!item) return;
        var touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        draggedItem = item;

        if (editMode) {
            // In edit mode, start drag immediately on touch
            holdTimer = setTimeout(function() { _startDrag(item, touch); }, 150);
        } else {
            // Long-press to enter edit mode
            holdTimer = setTimeout(function() {
                enterEditMode();
            }, HOLD_MS);
        }
    }, { passive: true });

    moreGrid.addEventListener('touchmove', function(e) {
        var touch = e.touches[0];
        var dx = Math.abs(touch.clientX - touchStartX);
        var dy = Math.abs(touch.clientY - touchStartY);

        if (!dragging) {
            if (dx > 5 || dy > 5) clearTimeout(holdTimer);
            return;
        }

        e.preventDefault();
        _moveDrag(touch);
    }, { passive: false });

    moreGrid.addEventListener('touchend', function() {
        clearTimeout(holdTimer);
        if (dragging) _endDrag();
    }, { passive: true });

    moreGrid.addEventListener('touchcancel', function() {
        clearTimeout(holdTimer);
        if (dragging) _endDrag();
    }, { passive: true });

    function _startDrag(item, touch) {
        dragging = true;
        item.classList.add('dragging');
        if (ghost) { ghost.remove(); ghost = null; }

        ghost = item.cloneNode(true);
        ghost.className = 'more-ghost';
        var rect = item.getBoundingClientRect();
        ghost.style.left = (touch.clientX - rect.width / 2) + 'px';
        ghost.style.top = (touch.clientY - rect.height / 2) + 'px';
        ghost.style.width = rect.width + 'px';
        document.body.appendChild(ghost);
    }

    function _moveDrag(touch) {
        if (!ghost || !draggedItem) return;

        var gw = ghost.offsetWidth;
        var gh = ghost.offsetHeight;
        ghost.style.left = (touch.clientX - gw / 2) + 'px';
        ghost.style.top = (touch.clientY - gh / 2) + 'px';

        // Find drop target
        var items = Array.from(moreGrid.querySelectorAll('.more-item'));
        var dropIndex = -1;

        for (var i = 0; i < items.length; i++) {
            var rect = items[i].getBoundingClientRect();
            var midX = rect.left + rect.width / 2;
            var midY = rect.top + rect.height / 2;
            if (touch.clientY < rect.bottom && touch.clientY > rect.top &&
                touch.clientX < midX) {
                dropIndex = i;
                break;
            }
            if (touch.clientY < midY) {
                dropIndex = i;
                break;
            }
        }
        if (dropIndex === -1) dropIndex = items.length;

        // FLIP: record positions
        var firstRects = {};
        items.forEach(function(el) { firstRects[el.id] = el.getBoundingClientRect(); });

        var currentIndex = items.indexOf(draggedItem);
        if (currentIndex !== -1 && dropIndex !== currentIndex && dropIndex !== currentIndex + 1) {
            if (dropIndex >= items.length) {
                moreGrid.appendChild(draggedItem);
            } else {
                var ref = items[dropIndex];
                if (ref !== draggedItem) moreGrid.insertBefore(draggedItem, ref);
            }

            // FLIP animate
            var updated = Array.from(moreGrid.querySelectorAll('.more-item'));
            updated.forEach(function(el) {
                if (!firstRects[el.id]) return;
                var last = el.getBoundingClientRect();
                var dxx = firstRects[el.id].left - last.left;
                var dyy = firstRects[el.id].top - last.top;
                if (dxx === 0 && dyy === 0) return;
                el.style.transform = 'translate(' + dxx + 'px,' + dyy + 'px)';
                el.style.transition = 'none';
                requestAnimationFrame(function() {
                    el.style.transition = 'transform 200ms ease';
                    el.style.transform = '';
                    el.addEventListener('transitionend', function handler() {
                        el.style.transition = '';
                        el.removeEventListener('transitionend', handler);
                    });
                });
            });
        }
    }

    function _endDrag() {
        clearTimeout(holdTimer);
        if (ghost) { ghost.remove(); ghost = null; }
        if (draggedItem) { draggedItem.classList.remove('dragging'); draggedItem = null; }
        if (dragging) { dragging = false; saveOrder(); }
    }
}

// ========================================
// Toolbar Key Buttons
// ========================================
function bindToolbarButtons() {
    document.querySelectorAll('[data-key]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            var action = KEYS[btn.dataset.key];
            if (action) action();
        });
    });
}


// ========================================
// Scroll Indicator + Scroll-to-bottom
// ========================================
function setupScrollControls() {
    var scrollIndicator = document.getElementById('scroll-indicator');
    var scrollBottomBtn = document.getElementById('scroll-bottom-btn');
    var scrollFadeTimer = null;

    function showScrollIndicator() {
        scrollIndicator.classList.add('visible');
        clearTimeout(scrollFadeTimer);
        scrollFadeTimer = setTimeout(function() {
            scrollIndicator.classList.remove('visible');
        }, 800);
    }

    // Expose for touch scroll module
    window._showScrollIndicator = showScrollIndicator;
    window._scrollBottomBtn = scrollBottomBtn;

    scrollBottomBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Ask server to exit copy-mode safely (no keys sent to running process)
        fetch('/api/tmux-scroll-bottom', { method: 'POST' }).catch(function() {});
        try {
            var viewport = frame.contentDocument.querySelector('.xterm-viewport');
            if (viewport) viewport.scrollTop = viewport.scrollHeight;
        } catch(ex) {}
        scrollBottomBtn.classList.remove('visible');
    });
}

// ========================================
// Prevent focus stealing (keep virtual keyboard open)
// ========================================
function setupFocusPrevention() {
    // Only on mobile — keeps virtual keyboard open when tapping buttons.
    // On desktop this breaks button focus and keyboard navigation.
    if (!isMobile) return;

    var SELECTOR = 'button, .key-btn, .tool-btn, .toolbar-row, .pm-item, .pm-memo-item, .pm-memo-del, .confirm-btn, #confirm-dialog, .view-tab, .preview-btn, .browser-tab, .browser-tab-close, #browser-tab-add, .send-history-item, .send-history-copy';

    document.addEventListener('touchstart', function(e) {
        if (e.target.id === 'preview-url') return;
        var t = e.target.closest(SELECTOR);
        if (t && t.id !== 'text-input') e.preventDefault();
    });
}

// ========================================
// Visibility Change (pause/resume polling)
// ========================================
function setupVisibilityHandlers() {
    var hiddenAt = 0;

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            hiddenAt = Date.now();
            stopUsagePolling();
            stopServerPolling();
            stopNotifyPolling();
            stopMonitorPolling();
            return;
        }
        // Visible again
        startUsagePolling();
        startServerPolling();
        startNotifyPolling();
        if (activeView === 'monitor') startMonitorPolling();
        fetchClaudeUsage();
        fetchServerStatus();
        fetchTmuxSession();

        // Reload iframe if away too long (mobile: 5s, desktop: 30min)
        var reloadThreshold = isMobile ? 5000 : 1800000;
        if (hiddenAt && Date.now() - hiddenAt > reloadThreshold) {
            frame.src = getTtydUrl();
        }
        hiddenAt = 0;
    });
}

// ========================================
// iOS Visual Viewport resize (keyboard)
// ========================================
function setupViewportResize() {
    // iOS virtual keyboard handling — desktop doesn't need this
    if (!isMobile) return;

    var app = document.getElementById('app');
    if (window.visualViewport) {
        function onViewportResize() {
            app.style.height = window.visualViewport.height + 'px';
            app.style.transform = 'translateY(' + window.visualViewport.offsetTop + 'px)';
        }
        window.visualViewport.addEventListener('resize', onViewportResize);
        window.visualViewport.addEventListener('scroll', onViewportResize);
    }
}

// ========================================
// Register service worker (network-first cache strategy)
// ========================================
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
            .then(function(reg) {
                // Force update check
                reg.update();
            })
            .catch(function() {});
    }
}

// ========================================
// Touch scroll init (retry after iframe load)
// ========================================
function setupTouchScroll() {
    initTouchScroll(frame, {
        sendText: sendText,
        sendKey: sendKey,
        tmuxCmd: tmuxCmd,
    });
}

// ========================================
// Main Initialization
// ========================================
// ========================================
// PWA Install Prompt
// ========================================
// Use the install prompt captured by inline script (avoids race condition)
var _deferredInstallPrompt = window._deferredInstallPrompt || null;
// Also listen for late arrivals
window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    _deferredInstallPrompt = e;
});

function isPWA() {
    // Standalone mode (installed PWA)
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS standalone
    if (window.navigator.standalone === true) return true;
    // TWA (Trusted Web Activity)
    if (document.referrer.includes('android-app://')) return true;
    return false;
}

function showPWAPrompt() {
    var overlay = document.getElementById('pwa-install-overlay');
    var app = document.getElementById('app');
    var installBtn = document.getElementById('pwa-install-btn');
    var iosInstructions = document.getElementById('pwa-ios-instructions');
    var genericInstructions = document.getElementById('pwa-generic-instructions');
    var skipBtn = document.getElementById('pwa-skip');
    var descEl = document.getElementById('pwa-desc');

    if (!overlay) { app.style.display = ''; return; }

    // Detect platform for appropriate instructions
    var ua = navigator.userAgent;
    var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isIOSSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);

    function makeStep(icon, html) {
        return '<div class="pwa-step"><span class="pwa-step-icon">' + icon + '</span><span>' + html + '</span></div>';
    }

    if (_deferredInstallPrompt) {
        // Chrome/Android — show native install button
        installBtn.style.display = '';
        descEl.textContent = t('pwa.descInstall');
        installBtn.textContent = t('pwa.installBtn');
        installBtn.addEventListener('click', function() {
            _deferredInstallPrompt.prompt();
            _deferredInstallPrompt.userChoice.then(function(result) {
                _deferredInstallPrompt = null;
                if (result.outcome === 'accepted') {
                    sessionStorage.setItem('pwa-skip', '1');
                }
            });
        });
    } else if (isIOSSafari || isIOS) {
        // iOS — show manual instructions
        iosInstructions.innerHTML =
            makeStep('&#x2B06;&#xFE0F;', t('pwa.iosStep1')) +
            makeStep('&#x2795;', t('pwa.iosStep2')) +
            makeStep('&#x2705;', t('pwa.iosStep3'));
        iosInstructions.style.display = '';
        descEl.textContent = isIOSSafari ? t('pwa.descIOS') : t('pwa.descIOSNotSafari');
    } else {
        // Other browsers
        genericInstructions.innerHTML =
            makeStep('&#x22EF;', t('pwa.genericStep1')) +
            makeStep('&#x2B07;&#xFE0F;', t('pwa.genericStep2'));
        genericInstructions.style.display = '';
        descEl.textContent = t('pwa.descGeneric');
    }

    skipBtn.textContent = t('pwa.skip');
    overlay.classList.add('visible');

    // Skip button — remember choice for this session
    skipBtn.addEventListener('click', function() {
        sessionStorage.setItem('pwa-skip', '1');
    });
}

(async function main() {
    // 1. Auth check (redirects to /login.html if not authenticated)
    await initAuth();

    // 1b. Load settings and init i18n before rendering any UI text
    var _initSettings = {};
    try {
        _initSettings = await fetch('/api/settings').then(function(r) { return r.json(); });
    } catch(e) {}
    var lang = (_initSettings.general && _initSettings.general.language) || 'en';
    await initI18n(lang);
    translateDOM();

    // 1c. PWA install check — show install prompt if not running as PWA
    if (!isPWA() && !sessionStorage.getItem('pwa-skip')) {
        showPWAPrompt();
        // Wait for user to skip (install will reload the page as standalone)
        await new Promise(function(resolve) {
            document.getElementById('pwa-skip').addEventListener('click', resolve);
            // Also resolve if install accepted (page may reload)
            window.addEventListener('appinstalled', function() { resolve(); });
        });
    }
    // Show app (hide overlay if it was shown)
    var pwaOverlay = document.getElementById('pwa-install-overlay');
    if (pwaOverlay) { pwaOverlay.classList.remove('visible'); pwaOverlay.classList.add('hidden'); }
    document.getElementById('app').style.display = '';

    // 2. iOS gestures (edge swipe blockers, popstate trap) + edge double-tap view switching
    initGestures({
        onEdgeDoubleTap: function(direction) {
            var tabs = Array.from(document.querySelectorAll('.view-tab'));
            if (tabs.length === 0) return;
            var currentIdx = -1;
            for (var i = 0; i < tabs.length; i++) {
                if (tabs[i].classList.contains('active')) { currentIdx = i; break; }
            }
            if (currentIdx < 0) return;
            var nextIdx;
            if (direction === 'next') {
                nextIdx = (currentIdx + 1) % tabs.length;
            } else {
                nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
            }
            var nextView = tabs[nextIdx].dataset.view;
            if (nextView) switchView(nextView);
        }
    });

    // 3. Resolve DOM references
    viewTabs = document.querySelectorAll('.view-tab');
    viewTabsBar = document.getElementById('view-tabs');
    terminalFrame = document.getElementById('terminal-frame');
    previewContainer = document.getElementById('preview-container');
    notesContainer = document.getElementById('notes-container');
    notesListView = document.getElementById('notes-list-view');
    notesEditorView = document.getElementById('notes-editor-view');
    brainContainer = document.getElementById('brain-container');
    brainTreeView = document.getElementById('brain-tree-view');
    brainEditorView = document.getElementById('brain-editor-view');
    dashContainer = document.getElementById('dash-container');
    launchContainer = document.getElementById('launch-container');
    filesContainer = document.getElementById('files-container');
    monitorContainer = document.getElementById('monitor-container');
    scrollIndicatorEl = document.getElementById('scroll-indicator');
    scrollBottomBtnEl = document.getElementById('scroll-bottom-btn');
    toolbarEl = document.getElementById('toolbar');
    keysBarEl = document.getElementById('keys-bar');
    inputBarEl = document.getElementById('input-bar');
    frame = document.getElementById('terminal-frame');
    textInput = document.getElementById('text-input');

    // 4. Initialize terminal (frame, input, send button)
    initTerminal(frame, textInput, document.getElementById('send-btn'));

    // 5. Initialize feature modules
    initPreview();
    window._openPreviewUrl = function(url) { switchView('preview'); navigateActiveTab(url); };
    initNotes();
    initBrain();
    initDash();
    initLaunch();
    initFiles();
    initMonitor();
    // 5a. Quick copy button in keys-bar
    // Pre-fetch on touchstart so text is ready by the time click fires
    var quickCopyBtn = document.getElementById('quick-copy-btn');
    if (quickCopyBtn) {
        quickCopyBtn.addEventListener('touchstart', function() {
            prefetchTerminalText(frame);
        }, { passive: true });
        quickCopyBtn.addEventListener('mousedown', function() {
            prefetchTerminalText(frame);
        }, { passive: true });
        quickCopyBtn.addEventListener('click', function(e) {
            e.preventDefault();
            quickCopy();
        });
    }

    // 5b. Pull-to-refresh on brain tree and dashboard (mobile only)
    if (isMobile) {
        var brainTreeItems = document.getElementById('brain-tree-items');
        if (brainTreeItems) {
            setupPullToRefresh(brainTreeItems, function(done) {
                loadBrainTree(done);
            });
        }
        var dashScroll = document.getElementById('dash-scroll');
        if (dashScroll) {
            setupPullToRefresh(dashScroll, function(done) {
                loadDashboard(done);
            });
        }
        var filesItems = document.getElementById('files-items');
        if (filesItems) {
            setupPullToRefresh(filesItems, function(done) {
                loadFiles(done);
            });
        }
        var launchScroll = document.getElementById('launch-scroll');
        if (launchScroll) {
            setupPullToRefresh(launchScroll, function(done) {
                loadLaunch(done);
            });
        }
        var monitorScroll = document.getElementById('monitor-scroll');
        if (monitorScroll) {
            setupPullToRefresh(monitorScroll, function(done) {
                loadMonitor(done);
            });
        }
    }

    // 6. Wire view switcher callbacks for notes and brain
    setNotesViewSwitcher(switchView);
    setBrainViewSwitcher(switchView);

    // 7. View tab click handlers
    viewTabs.forEach(function(tab) {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            switchView(tab.dataset.view);
        });
    });

    // 8. Initialize settings (with save/logout callbacks)
    initSettings({
        onSave: function(settings) {
            renderSnippets(settings.snippets || []);
            applyGeneral(settings.general || {});
            updateTermSettings(settings);
        },
        onLogout: function() {
            window.location.href = '/login.html';
        }
    });

    // 9. Load settings and apply on startup
    fetch('/api/settings')
        .then(function(r) { return r.json(); })
        .then(function(settings) {
            updateTermSettings(settings);
            renderSnippets(settings.snippets || []);
            applyGeneral(settings.general || {});
            if (settings.general && settings.general.tabOrder) {
                applyTabOrder(settings.general.tabOrder);
            }
        })
        .catch(function() {});

    // 10. Start all polling (tmux, usage, server)
    initPolling();

    // 11. Tmux polling pause/resume on view switch
    viewTabsBar.addEventListener('click', function() {
        // activeView is updated by switchView before this fires (bubble)
        setTimeout(function() {
            if (activeView === 'terminal') {
                fetchTmuxSession();
            }
        }, 0);
    });

    // 12. Bind toolbar key buttons
    bindToolbarButtons();

    // 12b. Send history close button
    var historyClose = document.getElementById('send-history-close');
    if (historyClose) {
        historyClose.addEventListener('click', function(e) {
            e.preventDefault();
            closeSendHistory();
        });
    }

    // 13. Setup UI features
    setupPlusMenu();
    setupToolbarToggle();
    setupMorePanel();
    setupScrollControls();
    setupFocusPrevention();

    // 14. Tab drag & drop reordering
    initTabDragDrop(viewTabsBar, saveTabOrder);

    // 15. Visibility change handlers (polling pause/resume + iframe reload)
    setupVisibilityHandlers();

    // 16. iOS virtual viewport resize handling
    setupViewportResize();

    // 17. Touch scroll on iframe load (mobile only)
    if (isMobile) setupTouchScroll();

    // 18. Register service worker
    registerServiceWorker();

})();
