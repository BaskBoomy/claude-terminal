// app.js — Main entry point (ES module)
// Orchestrates all modules, view switching, event bindings, and initialization.

import { initAuth } from './auth.js';
import { initTerminal, getTA, sendText, sendKey, tmuxCmd, uploadImage, submitInput, getTtydUrl, updateSettings as updateTermSettings } from './terminal.js';
import { initPolling, startUsagePolling, stopUsagePolling, startServerPolling, stopServerPolling, startNotifyPolling, stopNotifyPolling, fetchClaudeUsage, fetchServerStatus, fetchTmuxSession, setNotifyEnabled } from './polling.js';
import { initPreview } from './preview.js';
import { initNotes, loadNotesList, setViewSwitcher as setNotesViewSwitcher } from './notes.js';
import { initBrain, loadBrainTree, setViewSwitcher as setBrainViewSwitcher } from './brain.js';
import { initDash, loadDashboard } from './dash.js';
import { initSettings } from './settings.js';
import { initCopyMode } from './copy-mode.js';
import { initGestures, setupPullToRefresh, initTabDragDrop, initTouchScroll } from './gestures.js';
import { renderSnippets } from './snippets.js';
import { showToast, showConfirm, closeConfirm } from './utils.js';

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
var tmuxFab;
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

    viewTabs.forEach(function(tab) {
        tab.classList.toggle('active', tab.dataset.view === view);
    });

    terminalFrame.style.display = isTerm ? 'block' : 'none';
    previewContainer.style.display = view === 'preview' ? 'flex' : 'none';
    notesContainer.style.display = isNotes ? 'flex' : 'none';
    brainContainer.style.display = isBrain ? 'flex' : 'none';
    dashContainer.style.display = isDash ? 'flex' : 'none';

    // Hide all terminal-only chrome in non-terminal mode
    tmuxFab.style.display = isTerm ? '' : 'none';
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
    // Notification polling
    if (general.notification) {
        setNotifyEnabled(true);
        startNotifyPolling();
    } else {
        setNotifyEnabled(false);
        stopNotifyPolling();
    }
}

// ========================================
// Keys Map (toolbar + FAB)
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
        showConfirm('\uD604\uC7AC \uC138\uC158\uC744 \uC885\uB8CC\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?', [
            { label: '\uC885\uB8CC', style: 'primary', action: function() {
                tmuxCmd('&', 55);
                setTimeout(function() { sendText('y'); }, 200);
            }},
            { label: '\uCDE8\uC18C', style: 'cancel' }
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
            var title = text.split('\n')[0].substring(0, 50) || '\uBA54\uBAA8';
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
            empty.textContent = '\uC800\uC7A5\uB41C \uBA54\uBAA8 \uC5C6\uC74C';
            pmMemoList.appendChild(empty);
            return;
        }
        pmMemoCache.forEach(function(note) {
            var row = document.createElement('div');
            row.className = 'pm-memo-item';
            var text = document.createElement('span');
            text.className = 'pm-memo-text';
            text.textContent = note.title || note.preview || '\uC81C\uBAA9 \uC5C6\uC74C';
            var del = document.createElement('button');
            del.className = 'pm-memo-del';
            del.innerHTML = '&times;';
            function deleteMemo(e) {
                e.preventDefault();
                e.stopPropagation();
                closePlusMenu();
                showConfirm('\uC774 \uBA54\uBAA8\uB97C \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?', [
                    { label: '\uC0AD\uC81C', style: 'primary', action: function() {
                        fetch('/api/notes/' + note.id, { method: 'DELETE', credentials: 'same-origin' })
                            .then(function() { fetchMemoList(renderMemos); notesListLoaded = false; });
                    }},
                    { label: '\uCDE8\uC18C', style: 'cancel' }
                ]);
            }
            del.addEventListener('click', deleteMemo);
            del.addEventListener('touchend', deleteMemo);
            row.addEventListener('click', function() {
                // Fetch full content, then paste into input
                fetch('/api/notes/' + note.id, { credentials: 'same-origin' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        var memoContent = data.content || '';
                        var currentText = textInput.value.trim();
                        if (!currentText) {
                            textInput.value = memoContent;
                            autoResize();
                            sessionStorage.setItem('terminal-input', textInput.value);
                            closePlusMenu();
                            textInput.focus();
                            return;
                        }
                        closePlusMenu();
                        showConfirm('\uC785\uB825\uCC3D\uC5D0 \uB0B4\uC6A9\uC774 \uC788\uC2B5\uB2C8\uB2E4.', [
                            { label: '\uC800\uC7A5 \uD6C4 \uB36E\uC5B4\uC4F0\uAE30', style: 'primary', action: function() {
                                var saveTitle = currentText.split('\n')[0].substring(0, 50) || '\uBA54\uBAA8';
                                fetch('/api/notes', {
                                    method: 'POST', credentials: 'same-origin',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ title: saveTitle, content: currentText })
                                }).then(function() { notesListLoaded = false; });
                                textInput.value = memoContent;
                                autoResize();
                                sessionStorage.setItem('terminal-input', textInput.value);
                                textInput.focus();
                            }},
                            { label: '\uADF8\uB0E5 \uB36E\uC5B4\uC4F0\uAE30', style: 'secondary', action: function() {
                                textInput.value = memoContent;
                                autoResize();
                                sessionStorage.setItem('terminal-input', textInput.value);
                                textInput.focus();
                            }},
                            { label: '\uCDE8\uC18C', style: 'cancel' }
                        ]);
                    });
            });
            row.appendChild(text);
            row.appendChild(del);
            pmMemoList.appendChild(row);
        });
    }

    function openPlusMenu() {
        pmMemoList.innerHTML = '<div class="pm-empty">\uBD88\uB7EC\uC624\uB294 \uC911...</div>';
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
    imgBtn.addEventListener('touchend', function(e) {
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
    fileInputAny.addEventListener('change', function() {
        if (fileInputAny.files[0]) uploadImage(fileInputAny.files[0]);
        fileInputAny.value = '';
    });

    pmSaveMemo.addEventListener('click', function() {
        var text = textInput.value.trim();
        if (!text) return;
        var title = text.split('\n')[0].substring(0, 50) || '\uBA54\uBAA8';
        fetch('/api/notes', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title, content: text })
        }).then(function() {
            fetchMemoList(renderMemos);
            notesListLoaded = false;
        });
        closePlusMenu();
        // Green flash feedback
        textInput.style.background = '#1a3a1a';
        setTimeout(function() { textInput.style.background = ''; }, 300);
    });

    // Close menu on outside click
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#plus-menu') && !e.target.closest('#img-btn')) {
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
        toolbarToggle.innerHTML = open ? '\u25BC' : '\u25B2';
        sessionStorage.setItem('toolbars-open', open ? '1' : '0');
    }
    setToolbars(toolbarsOpen);

    toolbarToggle.addEventListener('click', function(e) {
        e.preventDefault();
        setToolbars(!toolbarsOpen);
    });
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
// FAB (tmux controls)
// ========================================
function setupFab() {
    var tmuxFabToggle = document.getElementById('tmux-fab-toggle');
    var tmuxFabPanel = document.getElementById('tmux-fab-panel');

    tmuxFabToggle.addEventListener('click', function(e) {
        e.preventDefault();
        tmuxFabPanel.classList.toggle('open');
    });
    // Close panel when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#tmux-fab')) {
            tmuxFabPanel.classList.remove('open');
        }
    });
    // Close panel on iframe focus (terminal click)
    window.addEventListener('blur', function() {
        tmuxFabPanel.classList.remove('open');
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
        sendKey('Escape', 27); // exit tmux copy-mode
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
    var SELECTOR = 'button, .key-btn, .tool-btn, .fab-btn, .fab-circle, .toolbar-row, #toolbar-toggle, .pm-item, .pm-memo-item, .pm-memo-del, .confirm-btn, #confirm-dialog, .view-tab, .preview-btn, .browser-tab, .browser-tab-close, #browser-tab-add';

    document.addEventListener('mousedown', function(e) {
        if (e.target.id === 'preview-url') return;
        var t = e.target.closest(SELECTOR);
        if (t && t.id !== 'text-input') e.preventDefault();
    });
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
            return;
        }
        // Visible again
        startUsagePolling();
        startServerPolling();
        startNotifyPolling();
        fetchClaudeUsage();
        fetchServerStatus();
        fetchTmuxSession();

        // Reload iframe if away for 5+ seconds
        if (hiddenAt && Date.now() - hiddenAt > 5000) {
            frame.src = getTtydUrl();
        }
        hiddenAt = 0;
    });
}

// ========================================
// iOS Visual Viewport resize (keyboard)
// ========================================
function setupViewportResize() {
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
// Unregister old service workers
// ========================================
function cleanupServiceWorkers() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
            regs.forEach(function(r) { r.unregister(); });
        });
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
(async function main() {
    // 1. Auth check (redirects to /login.html if not authenticated)
    await initAuth();

    // 2. iOS gestures (edge swipe blockers, popstate trap)
    initGestures();

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
    tmuxFab = document.getElementById('tmux-fab');
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
    initNotes();
    initBrain();
    initDash();
    initCopyMode();

    // 5b. Pull-to-refresh on brain tree and dashboard
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

    // 13. Setup UI features
    setupPlusMenu();
    setupToolbarToggle();
    setupFab();
    setupScrollControls();
    setupFocusPrevention();

    // 14. Tab drag & drop reordering
    initTabDragDrop(viewTabsBar, saveTabOrder);

    // 15. Visibility change handlers (polling pause/resume + iframe reload)
    setupVisibilityHandlers();

    // 16. iOS virtual viewport resize handling
    setupViewportResize();

    // 17. Touch scroll on iframe load
    setupTouchScroll();

    // 18. Cleanup old service workers
    cleanupServiceWorkers();

    // 19. Show body (was hidden until auth check passed)
    document.body.style.visibility = 'visible';
})();
