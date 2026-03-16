// files.js — File Explorer module
import { t } from './i18n.js';
import { I } from './icons.js';
import { renderMarkdown } from './markdown.js';

var currentPath = '', selectedFiles = new Set(), selectMode = false;
var favorites = [], sharedFilesDir = '', sortBy = 'name', sortDir = 'asc';
var isSpecialView = false, allItems = [], itemMap = {};

var SVG_S = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">';
var FILE_ICONS = {
    dir:    SVG_S + '<path d="M3 5v10a1 1 0 001 1h12a1 1 0 001-1V8a1 1 0 00-1-1H9.5L8 5H4a1 1 0 00-1 1z"/></svg>',
    image:  SVG_S + '<rect x="3" y="3" width="14" height="14" rx="1.5"/><circle cx="7.5" cy="7.5" r="1.5"/><path d="M3 13l4-4 3 3 2-2 5 5"/></svg>',
    code:   SVG_S + '<path d="M7 7L4 10l3 3"/><path d="M13 7l3 3-3 3"/><path d="M11 5l-2 10"/></svg>',
    web:    SVG_S + '<circle cx="10" cy="10" r="7"/><path d="M3 10h14"/><ellipse cx="10" cy="10" rx="3" ry="7"/></svg>',
    style:  SVG_S + '<path d="M12 3a4 4 0 00-8 3c0 3 4 4 4 7h4c0-3 4-4 4-7a4 4 0 00-4-3z"/><path d="M8 16h4"/><path d="M9 19h2"/></svg>',
    data:   SVG_S + '<path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M12 3v4h4"/><path d="M7 10h6"/><path d="M7 13h4"/></svg>',
    text:   SVG_S + '<path d="M5 3h10a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M7 7h6"/><path d="M7 10h6"/><path d="M7 13h3"/></svg>',
    pdf:    SVG_S + '<path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M12 3v4h4"/><path d="M7 11h1.5a1.5 1.5 0 000-3H7v6"/></svg>',
    archive:SVG_S + '<path d="M5 3h10a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M10 3v14"/><rect x="9" y="6" width="2" height="2"/><rect x="9" y="10" width="2" height="2"/></svg>',
    shell:  SVG_S + '<rect x="2" y="3" width="16" height="14" rx="2"/><path d="M6 8l3 2.5L6 13"/><path d="M11 13h4"/></svg>',
    lock:   SVG_S + '<rect x="5" y="9" width="10" height="8" rx="1"/><path d="M7 9V6a3 3 0 016 0v3"/><circle cx="10" cy="13" r="1"/></svg>',
    video:  SVG_S + '<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M8 8v4l4-2z" fill="currentColor"/></svg>',
    audio:  SVG_S + '<path d="M8 5v10"/><path d="M5 8v4"/><path d="M11 7v6"/><path d="M14 6v8"/><path d="M17 8v4"/><path d="M2 9v2"/></svg>',
    file:   SVG_S + '<path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M12 3v4h4"/></svg>'
};
var EXT_MAP = {};
['png','jpg','jpeg','gif','webp','svg','ico','bmp'].forEach(function(e) { EXT_MAP[e] = 'image'; });
['js','ts','jsx','tsx','go','py','rs','rb','java','kt','swift','c','cpp','h','php','lua'].forEach(function(e) { EXT_MAP[e] = 'code'; });
['json','yaml','yml','toml','xml','csv','sql','prisma'].forEach(function(e) { EXT_MAP[e] = 'data'; });
['md','txt','log'].forEach(function(e) { EXT_MAP[e] = 'text'; });
['pdf','doc','docx'].forEach(function(e) { EXT_MAP[e] = 'pdf'; });
['zip','tar','gz','rar','7z'].forEach(function(e) { EXT_MAP[e] = 'archive'; });
['sh','bash','zsh'].forEach(function(e) { EXT_MAP[e] = 'shell'; });
['conf','cfg','ini'].forEach(function(e) { EXT_MAP[e] = 'data'; });
['mp4','mov','avi','mkv'].forEach(function(e) { EXT_MAP[e] = 'video'; });
['mp3','wav','flac','ogg'].forEach(function(e) { EXT_MAP[e] = 'audio'; });
EXT_MAP['env'] = 'lock'; EXT_MAP['html'] = 'web'; EXT_MAP['css'] = 'style';
var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
var HTML_EXTS = ['html', 'htm'];
var VIDEO_EXTS = ['mp4', 'webm', 'mov'];
var AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
var MD_EXTS = ['md'];

function getIcon(item) { return item.isDir ? FILE_ICONS.dir : (FILE_ICONS[EXT_MAP[item.ext]] || FILE_ICONS.file); }

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'], i = 0, size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return (i === 0 ? size : size.toFixed(1)) + ' ' + units[i];
}

function formatDate(ms) {
    var d = new Date(ms), diff = new Date() - d;
    if (diff < 60000) return t('files.justNow');
    if (diff < 3600000) return t('files.minutesAgo', { n: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('files.hoursAgo', { n: Math.floor(diff / 3600000) });
    if (diff < 604800000) return t('files.daysAgo', { n: Math.floor(diff / 86400000) });
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function triggerDownload(url, filename) {
    var a = document.createElement('a');
    a.href = url; a.download = filename || '';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function copyText(text, toastKey) {
    navigator.clipboard.writeText(text).then(function() { window.showToast && window.showToast(t(toastKey)); });
}

function getDisplayItems(items) { return isSpecialView ? items : sortItems(items); }

// --- DOM refs ---
var $ = function(id) { return document.getElementById(id); };
var filesListView, filesPreviewView, pathBreadcrumb, fileItems, filterInput;
var previewBody, previewTitle, previewBackBtn;

function resolveDOM() {
    filesListView = $('files-list-view'); filesPreviewView = $('files-preview-view');
    pathBreadcrumb = $('files-breadcrumb'); fileItems = $('files-items');
    filterInput = $('files-filter'); previewBody = $('files-preview-body');
    previewTitle = $('files-preview-title'); previewBackBtn = $('files-preview-back');
}

// --- Sort ---
var SORT_CMP = {
    name: function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); },
    size: function(a, b) { return (a.size || 0) - (b.size || 0); },
    date: function(a, b) { return (a.modTime || 0) - (b.modTime || 0); }
};

function sortItems(items) {
    var cmpFn = SORT_CMP[sortBy] || SORT_CMP.name;
    return items.slice().sort(function(a, b) {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return (sortDir === 'asc' ? 1 : -1) * cmpFn(a, b);
    });
}

function updateSortUI() {
    var header = $('files-col-header');
    if (!header) return;
    header.style.display = isSpecialView ? 'none' : 'flex';
    header.querySelectorAll('.files-col-btn').forEach(function(btn) {
        var key = btn.dataset.sort;
        btn.classList.toggle('active', key === sortBy);
        btn.querySelector('.files-sort-icon').innerHTML = key === sortBy ? (sortDir === 'asc' ? ' ' + I.chevronUp : ' ' + I.chevronDown) : '';
    });
}

// --- Favorites ---
function loadFavorites() {
    fetch('/api/settings', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(s) { favorites = (s.general && s.general.fileFavorites) || []; })
        .catch(function() {});
}

function saveFavorites() {
    fetch('/api/settings', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(s) {
            s.general = s.general || {};
            s.general.fileFavorites = favorites;
            return fetch('/api/settings', { method: 'PUT', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
        });
}

function isFavorite(path) { return favorites.indexOf(path) !== -1; }

function toggleFavorite(path) {
    var idx = favorites.indexOf(path);
    if (idx === -1) favorites.push(path); else favorites.splice(idx, 1);
    saveFavorites();
}

// --- Common reset for loadDirectory/loadRecent ---
function resetView() {
    selectedFiles.clear(); selectMode = false;
    updateSelectUI(); updateSortUI(); filterInput.value = '';
}

// --- Breadcrumb (innerHTML + delegation) ---
function renderBreadcrumb(path) {
    var parts = path.split('/').filter(Boolean);
    var accumulated = '';
    var html = '<button class="files-crumb" data-crumb="">~</button>';
    parts.forEach(function(part, i) {
        accumulated += '/' + part;
        html += '<span class="files-crumb-sep">/</span>' +
            '<button class="files-crumb' + (i === parts.length - 1 ? ' active' : '') +
            '" data-crumb="' + escHtml(accumulated) + '">' + escHtml(part) + '</button>';
    });
    pathBreadcrumb.innerHTML = html;
    pathBreadcrumb.scrollLeft = pathBreadcrumb.scrollWidth;
}

// --- Load directory ---
function loadDirectory(path, done) {
    fetch('/api/files' + (path ? '?path=' + encodeURIComponent(path) : ''), { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            currentPath = data.path; allItems = data.items;
            if (data.filesDir) sharedFilesDir = data.filesDir;
            isSpecialView = false; resetView();
            renderBreadcrumb(data.path);
            renderItems(sortItems(data.items));
            if (done) done();
        })
        .catch(function() { if (done) done(); window.showToast && window.showToast(t('files.loadFailed')); });
}

// --- Load recent ---
function loadRecent(done) {
    fetch('/api/files/recent', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            allItems = data.files; currentPath = '';
            isSpecialView = true; resetView();
            pathBreadcrumb.innerHTML = '<span class="files-section-label">' + escHtml(t('files.recentFiles')) + '</span>';
            renderItems(data.files, true);
            if (done) done();
        })
        .catch(function() { if (done) done(); });
}

// --- Render items ---
function renderItems(items, showDir) {
    var html = '';
    itemMap = {};

    if (!currentPath && favorites.length > 0) {
        html += '<div class="files-section-label">' + I.starFilled + ' ' + escHtml(t('files.favorites')) + '</div>';
        favorites.forEach(function(fav) {
            html += '<div class="files-item" data-fav="' + escHtml(fav) + '">' +
                '<span class="files-item-icon">' + FILE_ICONS.dir + '</span>' +
                '<div class="files-item-info"><div class="files-item-name">' + escHtml(fav.split('/').pop() || fav) + '</div>' +
                '<div class="files-item-meta">' + escHtml(fav) + '</div></div>' +
                '<span class="files-item-arrow"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 1l5 4-5 4z"/></svg></span></div>';
        });
        html += '<div class="files-divider"></div>';
    }

    if (items.length === 0) {
        fileItems.innerHTML = html + '<div class="files-empty">' + escHtml(t('files.empty')) + '</div>';
        return;
    }

    items.forEach(function(item) {
        itemMap[item.path] = item;
        var metaText = '';
        if (showDir && item.dir) {
            var parts = [];
            if (!item.isDir) parts.push(formatSize(item.size));
            parts.push(formatDate(item.modTime), item.dir.replace(/^\/home\/[^/]+/, '~'));
            metaText = parts.join(' \u00B7 ');
        } else {
            metaText = item.isDir ? '' : formatSize(item.size);
        }

        html += '<div class="files-item' + (selectedFiles.has(item.path) ? ' selected' : '') +
            '" data-path="' + escHtml(item.path) + '">' +
            '<span class="files-item-icon">' + getIcon(item) + '</span>' +
            '<div class="files-item-info"><div class="files-item-name">' + escHtml(item.name) + '</div>' +
            '<div class="files-item-meta">' + escHtml(metaText) + '</div></div>';

        if (!showDir) {
            html += '<span class="files-item-size">' + (item.isDir ? '' : formatSize(item.size)) + '</span>' +
                '<span class="files-item-date">' + formatDate(item.modTime) + '</span>';
        }

        if (item.isDir) html += '<span class="files-item-arrow"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 1l5 4-5 4z"/></svg></span>';
        else if (!selectMode) html += '<button class="files-dl-btn" title="' + escHtml(t('files.download')) + '"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v8"/><path d="M4.5 8.5L8 12l3.5-3.5"/><path d="M3 14h10"/></svg></button>';
        html += '</div>';
    });
    fileItems.innerHTML = html;
}

// --- Select mode ---
function toggleSelect(path, row) {
    if (selectedFiles.has(path)) { selectedFiles.delete(path); row.classList.remove('selected'); }
    else { selectedFiles.add(path); row.classList.add('selected'); }
    updateSelectUI();
}

function updateSelectUI() {
    var bar = $('files-select-bar');
    if (!bar) return;
    bar.style.display = selectMode ? 'flex' : 'none';
    if (selectMode) $('files-select-count').textContent = selectedFiles.size > 0
        ? t('files.selected', { n: selectedFiles.size }) : t('files.selectFiles');
}

function enterSelectMode() { selectMode = true; selectedFiles.clear(); updateSelectUI(); renderItems(getDisplayItems(allItems)); }
function exitSelectMode() { selectMode = false; selectedFiles.clear(); updateSelectUI(); renderItems(getDisplayItems(allItems)); }

// --- Context menu ---
function showContextMenu(item) {
    if (navigator.vibrate) navigator.vibrate(30);
    var actions = [];
    if (!item.isDir) {
        actions.push({ label: t('files.download'), action: function() { downloadFile(item.path); } });
        actions.push({ label: t('files.qrShare'), action: function() { shareFile(item.path); } });
    }
    actions.push({ label: t('files.copyPath'), action: function() { copyText(item.path, 'files.pathCopied'); } });
    if (item.isDir) {
        actions.push({ label: isFavorite(item.path) ? t('files.removeFavorite') : t('files.addFavorite'), action: function() {
            toggleFavorite(item.path);
            window.showToast && window.showToast(isFavorite(item.path) ? t('files.favoriteAdded') : t('files.favoriteRemoved'));
        }});
    }
    if (!item.isDir) actions.push({ label: t('files.selectMode'), action: function() { enterSelectMode(); } });
    actions.push({ label: t('common.cancel'), style: 'cancel' });
    window.showConfirm && window.showConfirm(item.name, actions.map(function(a) {
        return { label: a.label, style: a.style || 'secondary', action: a.action };
    }));
}

// --- Download ---
function downloadFile(path) { triggerDownload('/api/files/download?path=' + encodeURIComponent(path), ''); }

function downloadZip() {
    if (selectedFiles.size === 0) return;
    fetch('/api/files/zip', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: Array.from(selectedFiles) })
    }).then(function(r) { if (!r.ok) throw new Error(); return r.blob(); })
    .then(function(blob) {
        var url = URL.createObjectURL(blob);
        triggerDownload(url, 'files.zip');
        URL.revokeObjectURL(url); exitSelectMode();
    }).catch(function() { window.showToast && window.showToast(t('files.zipFailed')); });
}

// --- Share ---
function shareFile(path) {
    fetch('/api/files/share', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path })
    }).then(function(r) { return r.json(); })
    .then(function(data) { showQRModal(data.url, data.name); })
    .catch(function() { window.showToast && window.showToast(t('files.shareFailed')); });
}

function showQRModal(url, name) {
    var overlay = document.createElement('div');
    overlay.className = 'files-qr-overlay';
    overlay.innerHTML = '<div class="files-qr-modal">' +
        '<div class="files-qr-title">' + escHtml(name) + '</div>' +
        '<div class="files-qr-url">' + escHtml(url) + '</div>' +
        '<div class="files-qr-note">' + escHtml(t('files.qrOneTime')) + '</div>' +
        '<div class="files-qr-actions">' +
        '<button class="files-qr-btn" id="qr-copy-btn">' + escHtml(t('files.copy')) + '</button>' +
        '<button class="files-qr-btn cancel" id="qr-close-btn">' + escHtml(t('common.close')) + '</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#qr-copy-btn').addEventListener('click', function() { copyText(url, 'files.urlCopied'); });
    overlay.querySelector('#qr-close-btn').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

// --- Preview ---
function rawUrl(path) { return '/api/files/raw?path=' + encodeURIComponent(path); }

function openPreview(item) {
    filesListView.style.display = 'none'; filesPreviewView.style.display = 'flex';
    previewTitle.textContent = item.name;
    previewBody.innerHTML = '<div class="files-loading">' + escHtml(t('common.loading')) + '</div>';
    var ext = (item.ext || '').toLowerCase();

    // Image
    if (IMAGE_EXTS.indexOf(ext) !== -1) {
        previewBody.innerHTML = '<div class="files-img-wrap"><img class="files-preview-img" src="/api/files/preview?path=' +
            encodeURIComponent(item.path) + '" alt="' + escHtml(item.name) + '"></div>';
        setupPreviewActions(item, 'image'); return;
    }

    // HTML — iframe with sandbox
    if (HTML_EXTS.indexOf(ext) !== -1) {
        previewBody.innerHTML = '<iframe class="files-preview-iframe" src="' + rawUrl(item.path) +
            '" sandbox="allow-scripts"></iframe>';
        setupPreviewActions(item, 'html'); return;
    }

    // PDF — browser native viewer
    if (ext === 'pdf') {
        previewBody.innerHTML = '<iframe class="files-preview-iframe" src="' + rawUrl(item.path) + '"></iframe>';
        setupPreviewActions(item, 'pdf'); return;
    }

    // Video
    if (VIDEO_EXTS.indexOf(ext) !== -1) {
        previewBody.innerHTML = '<div class="files-media-wrap"><video class="files-preview-video" controls autoplay>' +
            '<source src="' + rawUrl(item.path) + '"></video></div>';
        setupPreviewActions(item, 'video'); return;
    }

    // Audio
    if (AUDIO_EXTS.indexOf(ext) !== -1) {
        previewBody.innerHTML = '<div class="files-media-wrap"><audio class="files-preview-audio" controls autoplay>' +
            '<source src="' + rawUrl(item.path) + '"></audio></div>';
        setupPreviewActions(item, 'audio'); return;
    }

    // Text/Code/Markdown — fetch via preview API
    fetch('/api/files/preview?path=' + encodeURIComponent(item.path), { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.type === 'text') {
                // Markdown — render as HTML
                if (MD_EXTS.indexOf(ext) !== -1) {
                    previewBody.innerHTML = '<div class="files-preview-md">' + renderMarkdown(data.content) + '</div>';
                    setupPreviewActions(item, 'text', data.content); return;
                }
                var pre = document.createElement('pre');
                pre.className = 'files-preview-text'; pre.textContent = data.content;
                previewBody.innerHTML = ''; previewBody.appendChild(pre);
                setupPreviewActions(item, 'text', data.content);
            } else {
                previewBody.innerHTML = '<div class="files-binary-info"><span class="files-binary-icon">' + getIcon(item) + '</span>' +
                    '<div>' + escHtml(item.name) + '</div><div class="files-binary-size">' + formatSize(item.size) + '</div></div>';
                setupPreviewActions(item, 'binary');
            }
        })
        .catch(function() {
            previewBody.innerHTML = '<div class="files-binary-info"><div>' + escHtml(t('files.previewUnavailable')) + '</div></div>';
            setupPreviewActions(item, 'binary');
        });
}

function setupPreviewActions(item, type, content) {
    var footer = $('files-preview-footer');
    var html = '<button class="files-action-btn" id="pa-dl">' + escHtml(t('files.download')) + '</button>' +
        '<button class="files-action-btn secondary" id="pa-share">' + escHtml(t('files.qrShare')) + '</button>';
    if (type === 'text') html += '<button class="files-action-btn secondary" id="pa-edit">' + escHtml(t('files.edit')) + '</button>';
    if (type === 'html') html += '<button class="files-action-btn secondary" id="pa-preview">' + escHtml(t('files.openInPreview')) + '</button>';
    footer.innerHTML = html;
    footer.querySelector('#pa-dl').addEventListener('click', function() { downloadFile(item.path); });
    footer.querySelector('#pa-share').addEventListener('click', function() { shareFile(item.path); });
    if (type === 'text') footer.querySelector('#pa-edit').addEventListener('click', function() { openEditor(item, content); });
    if (type === 'html') footer.querySelector('#pa-preview').addEventListener('click', function() {
        window._openPreviewUrl && window._openPreviewUrl(rawUrl(item.path));
    });
}

// --- Editor ---
function openEditor(item, content) {
    previewBody.innerHTML = '';
    var textarea = document.createElement('textarea');
    textarea.className = 'files-edit-textarea'; textarea.value = content;
    previewBody.appendChild(textarea);

    var footer = $('files-preview-footer');
    footer.innerHTML = '<button class="files-action-btn" id="ed-save">' + escHtml(t('files.saveFile')) + '</button>' +
        '<button class="files-action-btn secondary" id="ed-cancel">' + escHtml(t('common.cancel')) + '</button>';
    footer.querySelector('#ed-save').addEventListener('click', function() {
        fetch('/api/files/edit', { method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: item.path, content: textarea.value })
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.ok) { window.showToast && window.showToast(t('files.fileSaved')); content = textarea.value; }
            else window.showToast && window.showToast(t('files.saveFailed') + ': ' + (data.error || ''));
        });
    });
    footer.querySelector('#ed-cancel').addEventListener('click', function() { openPreview(item); });
}

// --- Upload ---
function triggerUpload() {
    var input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.addEventListener('change', function() {
        if (!input.files || input.files.length === 0) return;
        var targetDir = currentPath || '';
        var promises = Array.from(input.files).map(function(file) {
            var fd = new FormData(); fd.append('file', file); fd.append('dir', targetDir);
            return fetch('/api/files/upload', { method: 'POST', credentials: 'same-origin', body: fd })
                .then(function(r) { return r.json(); });
        });
        Promise.allSettled(promises).then(function(results) {
            var n = results.filter(function(r) { return r.status === 'fulfilled'; }).length;
            if (n > 0) window.showToast && window.showToast(t('files.uploadComplete', { n: n }));
            loadDirectory(currentPath);
        });
    });
    input.click();
}

// --- Filter ---
function applyFilter(query) {
    if (!query) { renderItems(getDisplayItems(allItems)); return; }
    var q = query.toLowerCase();
    renderItems(getDisplayItems(allItems.filter(function(item) { return item.name.toLowerCase().indexOf(q) !== -1; })));
}

// --- Event delegation ---
function setupDelegation() {
    var longTimer = null, longPath = null, longTouchX = 0, longTouchY = 0, longFired = false;

    function startLong(path) {
        longPath = path; longFired = false;
        longTimer = setTimeout(function() {
            longTimer = null; longFired = true;
            var item = itemMap[longPath];
            if (item) showContextMenu(item);
        }, 500);
    }

    function clearLong() { if (longTimer) { clearTimeout(longTimer); longTimer = null; } }

    // Breadcrumb
    pathBreadcrumb.addEventListener('click', function(e) {
        var btn = e.target.closest('.files-crumb');
        if (btn && btn.dataset.crumb !== undefined) loadDirectory(btn.dataset.crumb);
    });

    // File items click
    fileItems.addEventListener('click', function(e) {
        if (longFired) { longFired = false; return; }
        var dlBtn = e.target.closest('.files-dl-btn');
        if (dlBtn) { e.stopPropagation(); var r = dlBtn.closest('.files-item'); if (r && r.dataset.path) downloadFile(r.dataset.path); return; }
        var row = e.target.closest('.files-item');
        if (!row) return;
        if (row.dataset.fav) { loadDirectory(row.dataset.fav); return; }
        var path = row.dataset.path, item = itemMap[path];
        if (!item) return;
        if (selectMode && !item.isDir) { toggleSelect(path, row); return; }
        if (item.isDir) loadDirectory(path); else openPreview(item);
    });

    // Long-press: touch
    fileItems.addEventListener('touchstart', function(e) {
        var row = e.target.closest('.files-item');
        if (!row || !row.dataset.path) return;
        var touch = e.touches[0];
        longTouchX = touch.clientX; longTouchY = touch.clientY;
        startLong(row.dataset.path);
    }, { passive: true });
    fileItems.addEventListener('touchend', clearLong);
    fileItems.addEventListener('touchmove', function(e) {
        if (!longTimer) return;
        var touch = e.touches[0], dx = touch.clientX - longTouchX, dy = touch.clientY - longTouchY;
        if (dx * dx + dy * dy > 100) clearLong();
    });

    // Long-press: mouse
    fileItems.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        var row = e.target.closest('.files-item');
        if (row && row.dataset.path) startLong(row.dataset.path);
    });
    fileItems.addEventListener('mouseup', clearLong);
    fileItems.addEventListener('mouseleave', clearLong);
}

// --- Init ---
export function initFiles() {
    resolveDOM(); loadFavorites();
    window._filesDownload = downloadFile;
    previewBackBtn.addEventListener('click', function() { filesPreviewView.style.display = 'none'; filesListView.style.display = 'flex'; });

    var filterTimer = null;
    filterInput.addEventListener('input', function() {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(function() { applyFilter(filterInput.value.trim()); }, 200);
    });

    $('files-home-btn').addEventListener('click', function() { loadDirectory(''); });
    $('files-recent-btn').addEventListener('click', function() { loadRecent(); });
    $('files-shared-btn').addEventListener('click', function() {
        if (sharedFilesDir) { loadDirectory(sharedFilesDir); return; }
        fetch('/api/files', { credentials: 'same-origin' }).then(function(r) { return r.json(); })
            .then(function(data) { if (data.filesDir) { sharedFilesDir = data.filesDir; loadDirectory(sharedFilesDir); } });
    });
    $('files-up-btn').addEventListener('click', function() {
        if (currentPath) loadDirectory(currentPath.split('/').slice(0, -1).join('/') || '/');
    });
    $('files-upload-btn').addEventListener('click', triggerUpload);
    $('files-refresh-btn').addEventListener('click', function() { if (currentPath) loadDirectory(currentPath); else loadRecent(); });

    $('files-col-header').querySelectorAll('.files-col-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var key = btn.dataset.sort;
            if (sortBy === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            else { sortBy = key; sortDir = 'asc'; }
            updateSortUI(); renderItems(sortItems(allItems));
        });
    });

    $('files-select-cancel').addEventListener('click', exitSelectMode);
    $('files-select-zip').addEventListener('click', downloadZip);
    setupDelegation();
}

export function loadFiles(done) { loadRecent(done); }
