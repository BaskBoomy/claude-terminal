// copy-mode.js — Long-press drag selection, text loupe, and quick copy for terminal

import { showToast } from './utils.js';

// ─── Constants ───────────────────────────────────────────────────────────────

var FINGER_TIP_OFFSET_Y = -8;
var LOUPE_COLS = 16;
var LOUPE_SCALE = 1.8;

// ─── CJK / Wide Character Utilities ─────────────────────────────────────────

function isWide(code) {
    return (code >= 0x1100 && code <= 0x115F) ||
        code === 0x2329 || code === 0x232A ||
        (code >= 0x2E80 && code <= 0x303E) ||
        (code >= 0x3040 && code <= 0x33BF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x4E00 && code <= 0xA4CF) ||
        (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFE30 && code <= 0xFE6F) ||
        (code >= 0xFF01 && code <= 0xFF60) ||
        (code >= 0xFFE0 && code <= 0xFFE6) ||
        (code >= 0x20000 && code <= 0x2FFFF);
}

/** Convert terminal column position to JS character index. */
function colToCharIndex(line, col) {
    var c = 0;
    for (var i = 0; i < line.length; i++) {
        if (c >= col) return i;
        c += isWide(line.charCodeAt(i)) ? 2 : 1;
    }
    return line.length;
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

function execCopy(text) {
    var tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.style.cssText = 'position:fixed;left:0;top:0;width:2em;height:2em;opacity:0.01;z-index:99999';
    document.body.appendChild(tmp);
    tmp.focus();
    tmp.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(tmp);
    return ok;
}

/** Copy text to clipboard with Clipboard API fallback to execCommand. */
function copyToClipboard(text) {
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(function () { showToast('Copied!'); })
            .catch(function () {
                showToast(execCopy(text) ? 'Copied!' : 'Copy failed');
            });
    } else {
        showToast(execCopy(text) ? 'Copied!' : 'Copy failed');
    }
}

// ─── Terminal Helpers ────────────────────────────────────────────────────────

/** Get xterm-screen element and its rects relative to both iframe and parent. */
function getScreenInfo(frame) {
    try {
        var screen = frame.contentDocument.querySelector('.xterm-screen');
        if (!screen) return null;
        return {
            el: screen,
            rect: screen.getBoundingClientRect(),
            frameRect: frame.getBoundingClientRect()
        };
    } catch (e) { return null; }
}

export function getCellSize(frame) {
    try {
        var term = frame.contentWindow.term;
        var screen = frame.contentDocument.querySelector('.xterm-screen');
        if (!term || !screen) return null;
        var rect = screen.getBoundingClientRect();
        return { width: rect.width / term.cols, height: rect.height / term.rows };
    } catch (e) { return null; }
}

export function invalidateCellSize() {}

export function touchToCell(frame, touchX, touchY) {
    var cell = getCellSize(frame);
    if (!cell) return null;
    var info = getScreenInfo(frame);
    if (!info) return null;
    var relX = touchX - info.rect.left;
    var relY = (touchY + FINGER_TIP_OFFSET_Y) - info.rect.top;
    return {
        row: Math.max(0, Math.floor(relY / cell.height)),
        col: Math.max(0, Math.floor(relX / cell.width))
    };
}

// ─── Pre-fetch Cache ─────────────────────────────────────────────────────────

var _prefetchedText = null;

function readXtermVisible(frame) {
    try {
        var term = frame.contentWindow.term;
        if (!term || !term.buffer) return null;
        var buf = term.buffer.active;
        var lines = [];
        for (var i = 0; i < term.rows; i++) {
            var line = buf.getLine(buf.viewportY + i);
            lines.push(line ? line.translateToString(true) : '');
        }
        return lines.join('\n');
    } catch (e) { return null; }
}

export function prefetchTerminalText(frame) {
    _prefetchedText = readXtermVisible(frame);
    if (_prefetchedText) return Promise.resolve(_prefetchedText);

    return fetch('/api/tmux-capture')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) { _prefetchedText = (data.text || '').trim(); return _prefetchedText; })
        .catch(function () { _prefetchedText = null; });
}

function getLines() {
    return _prefetchedText ? _prefetchedText.split('\n') : [];
}

// ─── Text Extraction ─────────────────────────────────────────────────────────

export function extractSelection(fullText, startCell, endCell) {
    var lines = fullText.split('\n');
    var s = startCell, e = endCell;
    if (s.row > e.row || (s.row === e.row && s.col > e.col)) { s = endCell; e = startCell; }
    var result = [];
    for (var r = s.row; r <= e.row; r++) {
        var line = lines[r] || '';
        var from = (r === s.row) ? colToCharIndex(line, s.col) : 0;
        var to = (r === e.row) ? colToCharIndex(line, e.col + 1) : line.length;
        result.push(line.substring(from, to).trimEnd());
    }
    return result.join('\n').trim();
}

// ─── Selection Overlay ───────────────────────────────────────────────────────

var _highlightEls = [];

export function showSelectionOverlay(frame, startCell, endCell) {
    clearSelectionOverlay();
    var cell = getCellSize(frame);
    var info = getScreenInfo(frame);
    if (!cell || !info) return;
    var s = startCell, e = endCell;
    if (s.row > e.row || (s.row === e.row && s.col > e.col)) { s = endCell; e = startCell; }
    var ox = info.frameRect.left + info.rect.left;
    var oy = info.frameRect.top + info.rect.top;
    var cols = Math.floor(info.rect.width / cell.width) || 80;
    for (var r = s.row; r <= e.row; r++) {
        var fromCol = (r === s.row) ? s.col : 0;
        var toCol = (r === e.row) ? e.col : cols - 1;
        var div = document.createElement('div');
        div.className = 'term-selection';
        div.style.cssText =
            'left:' + (ox + fromCol * cell.width) + 'px;' +
            'top:' + (oy + r * cell.height) + 'px;' +
            'width:' + ((toCol - fromCol + 1) * cell.width) + 'px;' +
            'height:' + cell.height + 'px;';
        document.body.appendChild(div);
        _highlightEls.push(div);
    }
}

export function clearSelectionOverlay() {
    _highlightEls.forEach(function (el) { el.remove(); });
    _highlightEls = [];
}

// ─── Cursor Line ─────────────────────────────────────────────────────────────

var _cursorLine = null;

export function showCursorLine(frame, cell) {
    if (!cell) return;
    var cellSize = getCellSize(frame);
    var info = getScreenInfo(frame);
    if (!cellSize || !info) return;

    var lines = getLines();
    var line = (cell.row >= 0 && cell.row < lines.length) ? lines[cell.row] : '';
    var charIdx = colToCharIndex(line, cell.col);
    var widthCols = isWide((line[charIdx] || '').charCodeAt(0)) ? 2 : 1;

    var ox = info.frameRect.left + info.rect.left;
    var oy = info.frameRect.top + info.rect.top;
    var lx = ox + cell.col * cellSize.width + (widthCols * cellSize.width) / 2;

    if (!_cursorLine) {
        _cursorLine = document.createElement('div');
        _cursorLine.id = 'term-cursor-line';
        document.body.appendChild(_cursorLine);
    }
    _cursorLine.style.cssText =
        'position:fixed;z-index:49;pointer-events:none;' +
        'left:' + (lx - 0.5) + 'px;top:' + oy + 'px;' +
        'width:1px;height:' + info.rect.height + 'px;' +
        'background:rgba(59,130,246,0.5);';
}

export function hideCursorLine() {
    if (_cursorLine) { _cursorLine.remove(); _cursorLine = null; }
}

// ─── Text Loupe ──────────────────────────────────────────────────────────────

var _loupeEl = null;

export function showLoupe(frame, cell, touchX, touchY) {
    if (!cell || !_prefetchedText) return;
    var lines = getLines();
    var cellSize = getCellSize(frame);
    if (!cellSize) return;

    // Extract single row around touch column
    var halfC = Math.floor(LOUPE_COLS / 2);
    var line = (cell.row >= 0 && cell.row < lines.length) ? lines[cell.row] : '';
    var fromIdx = colToCharIndex(line, Math.max(0, cell.col - halfC));
    var cursorIdx = colToCharIndex(line, cell.col);
    var toIdx = colToCharIndex(line, cell.col + halfC);
    while (line.length < toIdx) line += ' ';
    var excerpt = line.substring(fromIdx, toIdx);
    var cursorPos = cursorIdx - fromIdx;

    if (!_loupeEl) {
        _loupeEl = document.createElement('div');
        _loupeEl.id = 'term-loupe';
        document.body.appendChild(_loupeEl);
    }

    // Build content with cursor highlight
    var html = '';
    for (var c = 0; c < excerpt.length; c++) {
        var ch = excerpt[c] === ' ' ? '\u00a0' : excerpt[c];
        ch = ch.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (c === cursorPos) {
            var cls = 'loupe-cursor' + (isWide(excerpt[c].charCodeAt(0)) ? ' wide' : '');
            html += '<span class="' + cls + '">' + ch + '</span>';
        } else {
            html += ch;
        }
    }
    _loupeEl.innerHTML = html;

    // Position: directly above finger, centered on touch X
    var frameRect = frame.getBoundingClientRect();
    var parentX = touchX + frameRect.left;
    var parentY = touchY + frameRect.top;
    var loupeW = LOUPE_COLS * cellSize.width * LOUPE_SCALE + 16;
    var lx = Math.max(4, Math.min(parentX - loupeW / 2, window.innerWidth - loupeW - 4));
    var ly = parentY - 55;
    if (ly < 4) ly = parentY + 40;

    _loupeEl.style.cssText =
        'position:fixed;z-index:9998;pointer-events:none;' +
        'left:' + lx + 'px;top:' + ly + 'px;' +
        'padding:4px 8px;' +
        'background:rgba(30,29,26,0.95);' +
        'border:1px solid rgba(234,231,223,0.2);' +
        'border-radius:8px;' +
        'box-shadow:0 2px 12px rgba(0,0,0,0.5);' +
        'font-family:"SF Mono","Cascadia Code","Fira Code",monospace;' +
        'font-size:' + (cellSize.height * LOUPE_SCALE) + 'px;' +
        'line-height:1.3;color:#EAE7DF;white-space:pre;';
}

export function hideLoupe() {
    if (_loupeEl) { _loupeEl.remove(); _loupeEl = null; }
}

// ─── Floating Copy Button ────────────────────────────────────────────────────

var _floatingBtn = null;
var _floatingTimeout = null;

function showFloatingCopyBtn(x, y, text) {
    dismissFloatingCopyBtn();

    var btn = document.createElement('button');
    btn.id = 'floating-copy-btn';
    btn.textContent = 'Copy';
    var bx = Math.max(8, Math.min(x - 35, window.innerWidth - 78));
    var by = Math.max(8, y - 44);
    btn.style.cssText =
        'position:fixed;z-index:9999;left:' + bx + 'px;top:' + by + 'px;' +
        'padding:6px 18px;border:none;border-radius:8px;' +
        'background:var(--accent,#C96442);color:#fff;font-size:14px;font-weight:600;' +
        'font-family:-apple-system,system-ui,sans-serif;' +
        'box-shadow:0 2px 12px rgba(0,0,0,0.5);cursor:pointer;' +
        'touch-action:manipulation;-webkit-tap-highlight-color:transparent;';
    document.body.appendChild(btn);
    _floatingBtn = btn;

    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        copyToClipboard(text);
        dismissFloatingCopyBtn();
    });

    _floatingTimeout = setTimeout(dismissFloatingCopyBtn, 4000);
}

export function dismissFloatingCopyBtn() {
    if (_floatingBtn) { _floatingBtn.remove(); _floatingBtn = null; }
    if (_floatingTimeout) { clearTimeout(_floatingTimeout); _floatingTimeout = null; }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function quickCopy() {
    if (!_prefetchedText) { showToast('Text not ready, try again'); return; }
    copyToClipboard(_prefetchedText);
}

export function selectionCopy(frame, startCell, endCell, touchX, touchY) {
    if (!_prefetchedText) { showToast('Text not ready'); return; }
    var selected = extractSelection(_prefetchedText, startCell, endCell);
    if (!selected) { showToast('No text selected'); return; }
    showFloatingCopyBtn(touchX, touchY, selected);
}
