// copy-mode.js — ES module for terminal copy mode overlay

import { showToast } from './utils.js';

let copyOverlay = null;
let copyTextArea = null;
let copyStatusEl = null;
let copyStatusText = null;
let copyHistoryBtn = null;
let copyAllBtn = null;
let copyCloseBtn = null;
let copyModeBtn = null;
let isShowingHistory = false;

/**
 * Fallback copy using execCommand for older browsers
 */
function fallbackCopy(text) {
    const tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.style.position = 'fixed';
    tmp.style.left = '-9999px';
    tmp.style.top = '-9999px';
    document.body.appendChild(tmp);
    tmp.select();
    try {
        document.execCommand('copy');
    } catch (e) {
        // silent fail
    }
    document.body.removeChild(tmp);
}

/**
 * Show status message inside the overlay
 */
function showStatus(msg, isError) {
    if (!copyStatusEl) return;
    if (copyStatusText) {
        copyStatusText.textContent = msg;
    } else {
        copyStatusEl.textContent = msg;
    }
    copyStatusEl.classList.add('visible');
    copyStatusEl.classList.toggle('error', !!isError);
    clearTimeout(copyStatusEl._timer);
    copyStatusEl._timer = setTimeout(function () {
        copyStatusEl.classList.remove('visible', 'error');
    }, 2000);
}

/**
 * Open copy mode overlay
 * @param {boolean} withHistory - true to fetch scrollback history, false for current screen only
 */
export function openCopyMode(withHistory) {
    if (!copyOverlay || !copyTextArea) return;

    isShowingHistory = !!withHistory;
    var url = withHistory ? '/api/tmux-capture?history=1' : '/api/tmux-capture';

    fetch(url)
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(function (data) {
            copyTextArea.value = data.text || '';
            copyOverlay.classList.add('open');
            copyOverlay.style.display = 'flex';
            copyTextArea.focus();

            // Update history button label
            if (copyHistoryBtn) {
                copyHistoryBtn.textContent = withHistory ? '현재 화면' : '히스토리';
            }
        })
        .catch(function (err) {
            showStatus(err.message || '캡처 실패', true);
        });
}

/**
 * Close copy mode overlay
 */
export function closeCopyMode() {
    if (!copyOverlay) return;
    copyOverlay.classList.remove('open');
    copyOverlay.style.display = 'none';
    if (copyTextArea) copyTextArea.value = '';
    isShowingHistory = false;
}

/**
 * Copy all text in the textarea to clipboard
 */
function copyAllText() {
    if (!copyTextArea || !copyTextArea.value) return;

    var text = copyTextArea.value;
    copyTextArea.select();

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(function () {
                showStatus('복사됨!');
            })
            .catch(function () {
                fallbackCopy(text);
                showStatus('복사됨!');
            });
    } else {
        fallbackCopy(text);
        showStatus('복사됨!');
    }
}

/**
 * Initialize copy mode — bind event handlers for all copy mode buttons
 */
export function initCopyMode() {
    copyOverlay = document.getElementById('copy-overlay');
    copyTextArea = document.getElementById('copy-text-area');
    copyStatusEl = document.getElementById('copy-status');
    copyStatusText = document.getElementById('copy-status-text');
    copyHistoryBtn = document.getElementById('copy-history-btn');
    copyAllBtn = document.getElementById('copy-all-btn');
    copyCloseBtn = document.getElementById('copy-close-btn');
    copyModeBtn = document.getElementById('copy-mode-btn');

    // Trigger button — open current screen capture
    if (copyModeBtn) {
        copyModeBtn.addEventListener('click', function () {
            openCopyMode(false);
        });
    }

    // Close button
    if (copyCloseBtn) {
        copyCloseBtn.addEventListener('click', function () {
            closeCopyMode();
        });
    }

    // History toggle button
    if (copyHistoryBtn) {
        copyHistoryBtn.addEventListener('click', function () {
            openCopyMode(!isShowingHistory);
        });
    }

    // Copy all button
    if (copyAllBtn) {
        copyAllBtn.addEventListener('click', function () {
            copyAllText();
        });
    }

    // Escape key closes overlay
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && copyOverlay && copyOverlay.classList.contains('open')) {
            closeCopyMode();
        }
    });
}
