// terminal.js — ES module for terminal/xterm integration
import { showToast, showConfirm } from './utils.js';
import { t } from './i18n.js';

let frame = null;
let textInput = null;
let sendBtn = null;
let imgBtn = null;
let fileInput = null;
let clearInputBtn = null;
let scrollBottomBtnEl = null;

let inputHistory = [];
let historyIndex = -1;
let sendPending = false;

let settings = { general: {} };

export function updateSettings(s) {
    settings = s;
}

// --- History persistence ---
function saveHistory() {
    try {
        localStorage.setItem('terminal-history', JSON.stringify(inputHistory));
    } catch (e) {}
}

export function getInputHistory() {
    return inputHistory;
}

export function openSendHistory() {
    var panel = document.getElementById('send-history-panel');
    var list = document.getElementById('send-history-list');
    if (!panel || !list) return;
    list.innerHTML = '';
    if (inputHistory.length === 0) {
        list.innerHTML = '<div style="padding:20px 14px;color:var(--text-subtle);font-size:13px;">' + t('terminal.noHistory') + '</div>';
    } else {
        // Show most recent first
        for (var i = inputHistory.length - 1; i >= 0; i--) {
            (function(text) {
                var item = document.createElement('div');
                item.className = 'send-history-item';
                var span = document.createElement('span');
                span.className = 'send-history-text';
                span.textContent = text;
                item.appendChild(span);
                var copyBtn = document.createElement('button');
                copyBtn.className = 'send-history-copy';
                copyBtn.innerHTML = '&#x1F4CB;';
                copyBtn.title = t('terminal.pasteToInput');
                copyBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    textInput.value = text;
                    sessionStorage.setItem('terminal-input', text);
                    updateClearBtn();
                    closeSendHistory();
                    textInput.focus();
                });
                item.appendChild(copyBtn);
                // Tap item = paste + close
                item.addEventListener('click', function() {
                    textInput.value = text;
                    sessionStorage.setItem('terminal-input', text);
                    updateClearBtn();
                    closeSendHistory();
                    textInput.focus();
                });
                list.appendChild(item);
            })(inputHistory[i]);
        }
    }
    panel.classList.add('open');
}

export function closeSendHistory() {
    var panel = document.getElementById('send-history-panel');
    if (panel) panel.classList.remove('open');
}

// --- Auto-resize textarea ---
function autoResize() {
    // Switch to multi-line mode for measurement
    textInput.style.lineHeight = '1.4';
    textInput.style.padding = '8px 72px 8px 14px';
    textInput.style.height = 'auto';
    var h = Math.min(textInput.scrollHeight, 120);
    // If single line (content fits in ~38px), revert to centered mode
    if (h <= 38) {
        textInput.style.lineHeight = '';
        textInput.style.padding = '';
        textInput.style.height = '';
    } else {
        textInput.style.height = h + 'px';
    }
}

function updateClearBtn() {
    if (clearInputBtn) {
        clearInputBtn.classList.toggle('visible', textInput.value.length > 0);
    }
}


// --- Find xterm.js hidden textarea inside iframe ---
export function getTA() {
    try {
        return frame.contentDocument.querySelector('.xterm-helper-textarea') ||
               frame.contentDocument.querySelector('textarea');
    } catch (e) {
        return null;
    }
}

// --- Send text via input event (char by char) ---
export function sendText(text) {
    var ta = getTA();
    if (!ta) return false;
    for (var i = 0; i < text.length; i++) {
        ta.value = text[i];
        ta.dispatchEvent(new InputEvent('input', {
            data: text[i], inputType: 'insertText', bubbles: true
        }));
    }
    ta.value = '';
    return true;
}

// --- Send special key via keydown event ---
export function sendKey(key, keyCode, mods) {
    var ta = getTA();
    if (!ta) return false;
    ta.dispatchEvent(new KeyboardEvent('keydown', {
        key: key, keyCode: keyCode, which: keyCode,
        bubbles: true, cancelable: true,
        ctrlKey: !!(mods && mods.ctrl),
        altKey: !!(mods && mods.alt),
        shiftKey: !!(mods && mods.shift)
    }));
    return true;
}

// --- tmux prefix (Ctrl+B) then command key ---
export function tmuxCmd(cmdKey, cmdKeyCode) {
    sendKey('b', 66, { ctrl: true });
    setTimeout(function () {
        sendKey(cmdKey, cmdKeyCode);
    }, 50);
}

// --- File upload ---
export function uploadImage(file) {
    if (imgBtn) imgBtn.classList.add('uploading');
    fetch('/upload', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            var cur = textInput.value;
            textInput.value = cur ? cur + ' ' + data.path : data.path;
        })
        .catch(function () {
            textInput.value += '[upload failed]';
        })
        .finally(function () {
            if (imgBtn) imgBtn.classList.remove('uploading');
            if (fileInput) fileInput.value = '';
        });
}

// --- Internal: send text + Enter with retry ---
function doSendInput(text) {
    var ta = getTA();
    if (!ta) {
        // Retry up to 3 times (iframe may be temporarily inaccessible)
        var retries = 0;
        var retryTimer = setInterval(function () {
            retries++;
            var ta2 = getTA();
            if (ta2) {
                clearInterval(retryTimer);
                actualSend(text, ta2);
            } else if (retries >= 3) {
                clearInterval(retryTimer);
                showToast(t('terminal.sendFailed'), 2000);
                textInput.style.background = '#3a1515';
                setTimeout(function () { textInput.style.background = ''; }, 600);
                // Don't clear input — user can retry
            }
        }, 200);
        return;
    }
    actualSend(text, ta);
}

function clearInput() {
    textInput.value = '';
    textInput.style.height = '';
    textInput.style.lineHeight = '';
    textInput.style.padding = '';
    sessionStorage.removeItem('terminal-input');
    updateClearBtn();
}

function actualSend(text, ta) {
    // Send text char by char
    if (text) {
        for (var i = 0; i < text.length; i++) {
            ta.value = text[i];
            ta.dispatchEvent(new InputEvent('input', {
                data: text[i], inputType: 'insertText', bubbles: true
            }));
        }
        ta.value = '';
    }
    // Enter after text is processed, clear input only after Enter is sent
    setTimeout(function () {
        var ta2 = getTA();
        if (ta2) {
            ta2.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', keyCode: 13, which: 13,
                bubbles: true, cancelable: true
            }));
            // Success — now safe to clear
            if (text) {
                inputHistory.push(text);
                if (inputHistory.length > 50) inputHistory.shift();
                saveHistory();
            }
            historyIndex = -1;
            clearInput();
        } else {
            // Enter failed — keep text in input
            showToast(t('terminal.sendFailed'), 2000);
        }
    }, 80);
}

// --- Main submit function ---
export function submitInput() {
    var text = textInput.value;

    // If scrolled up, exit copy-mode via server API + scroll to bottom, then send
    if (scrollBottomBtnEl && scrollBottomBtnEl.classList.contains('visible')) {
        var actuallyScrolledUp = false;
        try {
            var viewport = frame.contentDocument.querySelector('.xterm-viewport');
            if (viewport) {
                actuallyScrolledUp = viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 10;
            }
        } catch (e) {}

        if (actuallyScrolledUp) {
            fetch('/api/tmux-scroll-bottom', { method: 'POST' })
                .catch(function() {})
                .finally(function() {
                    try {
                        var vp = frame.contentDocument.querySelector('.xterm-viewport');
                        if (vp) vp.scrollTop = vp.scrollHeight;
                    } catch (e) {}
                    scrollBottomBtnEl.classList.remove('visible');
                    setTimeout(function () {
                        doSendInput(text);
                    }, 150);
                });
            return;
        }
        // Button visible but actually at bottom — stale state
        scrollBottomBtnEl.classList.remove('visible');
    }

    doSendInput(text);
}

// --- Build ttyd URL with fontSize param ---
export function getTtydUrl() {
    var size = (settings.general && settings.general.termFontSize) || 15;
    return size !== 15 ? '/ttyd/?fontSize=' + size : '/ttyd/';
}

// --- Initialize terminal module ---
export function initTerminal(frameEl, textInputEl, sendBtnEl) {
    frame = frameEl;
    textInput = textInputEl;
    sendBtn = sendBtnEl;
    imgBtn = document.getElementById('img-btn');
    fileInput = document.getElementById('file-input');
    clearInputBtn = document.getElementById('clear-input');
    scrollBottomBtnEl = document.getElementById('scroll-bottom-btn');

    // Load history from localStorage
    try {
        inputHistory = JSON.parse(localStorage.getItem('terminal-history') || '[]');
    } catch (e) {
        inputHistory = [];
    }
    historyIndex = -1;

    // Restore persisted input text
    var savedInput = sessionStorage.getItem('terminal-input');
    if (savedInput) textInput.value = savedInput;
    updateClearBtn();

    // --- Input event: persist + auto-resize + clear button ---
    textInput.addEventListener('input', function () {
        sessionStorage.setItem('terminal-input', textInput.value);
        autoResize();
        updateClearBtn();
    });

    // --- Clear button: tap = clear, double-tap = copy ---
    if (clearInputBtn) {
        var lastTapTime = 0;
        var clearTimer = null;

        function doCopy() {
            if (!textInput.value) return;
            var text = textInput.value;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function() {
                        showToast(t('terminal.copied'), 1500);
                    }).catch(function() {
                        fallbackCopy(text);
                        showToast(t('terminal.copied'), 1500);
                    });
                } else {
                    fallbackCopy(text);
                    showToast(t('terminal.copied'), 1500);
                }
            } catch(e) {
                fallbackCopy(text);
                showToast(t('terminal.copied'), 1500);
            }
        }
        function fallbackCopy(text) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        function doClear() {
            showConfirm(t('terminal.clearConfirm'), [
                { label: t('common.delete'), className: 'primary', action: function() {
                    clearInput();
                    textInput.focus();
                }},
                { label: t('common.cancel'), className: 'cancel' }
            ]);
        }

        clearInputBtn.addEventListener('click', function(e) {
            e.preventDefault();
            var now = Date.now();
            if (now - lastTapTime < 400) {
                // Double tap = copy (cancel pending clear)
                clearTimeout(clearTimer);
                doCopy();
                lastTapTime = 0;
            } else {
                // Single tap = wait for possible double tap
                lastTapTime = now;
                clearTimer = setTimeout(function() {
                    if (lastTapTime === now && textInput.value) {
                        doClear();
                    }
                }, 350);
            }
        });
    }

    // --- Paste image from clipboard ---
    textInput.addEventListener('paste', function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image/') === 0) {
                e.preventDefault();
                uploadImage(items[i].getAsFile());
                return;
            }
        }
    });

    // --- Keydown: Shift+Enter to submit, ArrowUp/Down for history ---
    textInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.shiftKey && !e.isComposing) {
            e.preventDefault();
            submitInput();
        } else if (e.key === 'ArrowUp' && !e.isComposing && document.activeElement === textInput) {
            if (inputHistory.length > 0 && historyIndex < inputHistory.length - 1) {
                e.preventDefault();
                historyIndex++;
                textInput.value = inputHistory[inputHistory.length - 1 - historyIndex];
                autoResize();
            }
        } else if (e.key === 'ArrowDown' && !e.isComposing && document.activeElement === textInput) {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                textInput.value = inputHistory[inputHistory.length - 1 - historyIndex];
            } else {
                historyIndex = -1;
                textInput.value = '';
            }
            autoResize();
        }
    });

    // --- Send button: touchend with sendPending guard ---
    sendBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        if (sendPending) return;
        sendPending = true;
        submitInput();
        setTimeout(function () { sendPending = false; }, 300);
    });

    // --- Send button: click (desktop only, touchend preventDefault blocks on mobile) ---
    sendBtn.addEventListener('click', function (e) {
        if (sendPending) return;
        sendPending = true;
        submitInput();
        setTimeout(function () { sendPending = false; }, 300);
    });
}
