// files.js — File Explorer module
// Browse, download, upload, preview, share, favorites

import { t } from './i18n.js';

var currentPath = '';
var selectedFiles = new Set();
var selectMode = false;
var favorites = [];
var viewSwitcherFn = null;

// --- Icon map by extension ---
var EXT_ICONS = {
    dir: '\u{1F4C1}',
    png: '\u{1F5BC}', jpg: '\u{1F5BC}', jpeg: '\u{1F5BC}', gif: '\u{1F5BC}',
    webp: '\u{1F5BC}', svg: '\u{1F5BC}', ico: '\u{1F5BC}', bmp: '\u{1F5BC}',
    js: '\u{1F4DC}', ts: '\u{1F4DC}', jsx: '\u{1F4DC}', tsx: '\u{1F4DC}',
    go: '\u{1F4DC}', py: '\u{1F4DC}', rs: '\u{1F4DC}', rb: '\u{1F4DC}',
    java: '\u{1F4DC}', kt: '\u{1F4DC}', swift: '\u{1F4DC}', c: '\u{1F4DC}',
    cpp: '\u{1F4DC}', h: '\u{1F4DC}', php: '\u{1F4DC}', lua: '\u{1F4DC}',
    html: '\u{1F310}', css: '\u{1F3A8}',
    json: '\u{1F4CB}', yaml: '\u{1F4CB}', yml: '\u{1F4CB}', toml: '\u{1F4CB}',
    xml: '\u{1F4CB}', csv: '\u{1F4CB}', sql: '\u{1F4CB}', prisma: '\u{1F4CB}',
    md: '\u{1F4DD}', txt: '\u{1F4DD}', log: '\u{1F4DD}',
    pdf: '\u{1F4D5}', doc: '\u{1F4D5}', docx: '\u{1F4D5}',
    zip: '\u{1F4E6}', tar: '\u{1F4E6}', gz: '\u{1F4E6}', rar: '\u{1F4E6}', '7z': '\u{1F4E6}',
    sh: '\u{2699}', bash: '\u{2699}', zsh: '\u{2699}',
    env: '\u{1F512}', conf: '\u{2699}', cfg: '\u{2699}', ini: '\u{2699}',
    mp4: '\u{1F3AC}', mov: '\u{1F3AC}', avi: '\u{1F3AC}', mkv: '\u{1F3AC}',
    mp3: '\u{1F3B5}', wav: '\u{1F3B5}', flac: '\u{1F3B5}', ogg: '\u{1F3B5}',
};

function getIcon(item) {
    if (item.isDir) return EXT_ICONS.dir;
    return EXT_ICONS[item.ext] || '\u{1F4C4}';
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    var size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return (i === 0 ? size : size.toFixed(1)) + ' ' + units[i];
}

function formatDate(ms) {
    var d = new Date(ms);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return t('files.justNow');
    if (diff < 3600000) return t('files.minutesAgo', { n: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('files.hoursAgo', { n: Math.floor(diff / 3600000) });
    if (diff < 604800000) return t('files.daysAgo', { n: Math.floor(diff / 86400000) });
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
}

// --- DOM refs ---
var filesContainer, filesListView, filesPreviewView;
var pathBar, pathBreadcrumb, fileItems, filterInput;
var previewHeader, previewBody, previewTitle, previewBackBtn;

function resolveDOM() {
    filesContainer = document.getElementById('files-container');
    filesListView = document.getElementById('files-list-view');
    filesPreviewView = document.getElementById('files-preview-view');
    pathBar = document.getElementById('files-path-bar');
    pathBreadcrumb = document.getElementById('files-breadcrumb');
    fileItems = document.getElementById('files-items');
    filterInput = document.getElementById('files-filter');
    previewHeader = document.getElementById('files-preview-header');
    previewBody = document.getElementById('files-preview-body');
    previewTitle = document.getElementById('files-preview-title');
    previewBackBtn = document.getElementById('files-preview-back');
}

// ========================================
// Load favorites from settings
// ========================================
function loadFavorites() {
    fetch('/api/settings', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(s) {
            favorites = (s.general && s.general.fileFavorites) || [];
        })
        .catch(function() {});
}

function saveFavorites() {
    fetch('/api/settings', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(s) {
            s.general = s.general || {};
            s.general.fileFavorites = favorites;
            return fetch('/api/settings', {
                method: 'PUT', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(s)
            });
        });
}

function isFavorite(path) {
    return favorites.indexOf(path) !== -1;
}

function toggleFavorite(path) {
    var idx = favorites.indexOf(path);
    if (idx === -1) {
        favorites.push(path);
    } else {
        favorites.splice(idx, 1);
    }
    saveFavorites();
}

// ========================================
// Render breadcrumb
// ========================================
function renderBreadcrumb(path) {
    pathBreadcrumb.innerHTML = '';
    var parts = path.split('/').filter(Boolean);
    var accumulated = '';

    var homeBtn = document.createElement('button');
    homeBtn.className = 'files-crumb';
    homeBtn.textContent = '~';
    homeBtn.addEventListener('click', function() { loadDirectory(''); });
    pathBreadcrumb.appendChild(homeBtn);

    parts.forEach(function(part, i) {
        accumulated += '/' + part;
        var sep = document.createElement('span');
        sep.className = 'files-crumb-sep';
        sep.textContent = '/';
        pathBreadcrumb.appendChild(sep);

        var btn = document.createElement('button');
        btn.className = 'files-crumb';
        if (i === parts.length - 1) btn.classList.add('active');
        btn.textContent = part;
        var target = accumulated;
        btn.addEventListener('click', function() { loadDirectory(target); });
        pathBreadcrumb.appendChild(btn);
    });

    pathBreadcrumb.scrollLeft = pathBreadcrumb.scrollWidth;
}

// ========================================
// Load directory listing
// ========================================
var allItems = [];

function loadDirectory(path, done) {
    var url = '/api/files' + (path ? '?path=' + encodeURIComponent(path) : '');
    fetch(url, { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            currentPath = data.path;
            allItems = data.items;
            selectedFiles.clear();
            selectMode = false;
            updateSelectUI();
            renderBreadcrumb(data.path);
            renderItems(data.items);
            filterInput.value = '';
            if (done) done();
        })
        .catch(function() {
            if (done) done();
            window.showToast && window.showToast(t('files.loadFailed'));
        });
}

// ========================================
// Load recent files
// ========================================
function loadRecent(done) {
    fetch('/api/files/recent', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            allItems = data.files;
            currentPath = '';
            selectedFiles.clear();
            selectMode = false;
            updateSelectUI();
            pathBreadcrumb.innerHTML = '<span class="files-section-label">' + escHtml(t('files.recentFiles')) + '</span>';
            renderItems(data.files, true);
            filterInput.value = '';
            if (done) done();
        })
        .catch(function() { if (done) done(); });
}

// ========================================
// Render file items
// ========================================
function renderItems(items, showDir) {
    fileItems.innerHTML = '';

    // Favorites section
    if (!currentPath && favorites.length > 0) {
        var favLabel = document.createElement('div');
        favLabel.className = 'files-section-label';
        favLabel.textContent = t('files.favorites');
        fileItems.appendChild(favLabel);
        favorites.forEach(function(fav) {
            var row = document.createElement('div');
            row.className = 'files-item';
            row.innerHTML = '<span class="files-item-icon">\u{1F4C1}</span>' +
                '<div class="files-item-info"><div class="files-item-name">' + escHtml(fav.split('/').pop() || fav) + '</div>' +
                '<div class="files-item-meta">' + escHtml(fav) + '</div></div>' +
                '<span class="files-item-arrow">\u25B6</span>';
            row.addEventListener('click', function() { loadDirectory(fav); });
            fileItems.appendChild(row);
        });
        var divider = document.createElement('div');
        divider.className = 'files-divider';
        fileItems.appendChild(divider);
    }

    if (items.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'files-empty';
        empty.textContent = t('files.empty');
        fileItems.appendChild(empty);
        return;
    }

    items.forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'files-item';
        row.dataset.path = item.path;
        if (selectedFiles.has(item.path)) row.classList.add('selected');

        var icon = document.createElement('span');
        icon.className = 'files-item-icon';
        icon.textContent = getIcon(item);

        var info = document.createElement('div');
        info.className = 'files-item-info';

        var name = document.createElement('div');
        name.className = 'files-item-name';
        name.textContent = item.name;

        var meta = document.createElement('div');
        meta.className = 'files-item-meta';
        var metaParts = [];
        if (!item.isDir) metaParts.push(formatSize(item.size));
        metaParts.push(formatDate(item.modTime));
        if (showDir && item.dir) {
            var shortDir = item.dir.replace(/^\/home\/[^/]+/, '~');
            metaParts.push(shortDir);
        }
        meta.textContent = metaParts.join(' \u00B7 ');

        info.appendChild(name);
        info.appendChild(meta);
        row.appendChild(icon);
        row.appendChild(info);

        if (item.isDir) {
            var arrow = document.createElement('span');
            arrow.className = 'files-item-arrow';
            arrow.textContent = '\u25B6';
            row.appendChild(arrow);
        } else if (!selectMode) {
            var dlBtn = document.createElement('button');
            dlBtn.className = 'files-dl-btn';
            dlBtn.innerHTML = '\u2B07';
            dlBtn.title = t('files.download');
            dlBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                downloadFile(item.path);
            });
            row.appendChild(dlBtn);
        }

        row.addEventListener('click', function() {
            if (selectMode && !item.isDir) {
                toggleSelect(item.path, row);
                return;
            }
            if (item.isDir) {
                loadDirectory(item.path);
            } else {
                openPreview(item);
            }
        });

        // Long press for context menu
        var longTimer = null;
        row.addEventListener('touchstart', function(e) {
            longTimer = setTimeout(function() {
                longTimer = null;
                showContextMenu(item, e);
            }, 500);
        }, { passive: true });
        row.addEventListener('touchend', function() { if (longTimer) clearTimeout(longTimer); });
        row.addEventListener('touchmove', function() { if (longTimer) clearTimeout(longTimer); });

        fileItems.appendChild(row);
    });
}

function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ========================================
// Select mode (multi-select for zip)
// ========================================
function toggleSelect(path, row) {
    if (selectedFiles.has(path)) {
        selectedFiles.delete(path);
        row.classList.remove('selected');
    } else {
        selectedFiles.add(path);
        row.classList.add('selected');
    }
    updateSelectUI();
}

function updateSelectUI() {
    var bar = document.getElementById('files-select-bar');
    if (!bar) return;
    if (selectMode && selectedFiles.size > 0) {
        bar.style.display = 'flex';
        document.getElementById('files-select-count').textContent = t('files.selected', { n: selectedFiles.size });
    } else if (selectMode) {
        bar.style.display = 'flex';
        document.getElementById('files-select-count').textContent = t('files.selectFiles');
    } else {
        bar.style.display = 'none';
    }
}

function enterSelectMode() {
    selectMode = true;
    selectedFiles.clear();
    updateSelectUI();
    renderItems(allItems);
}

function exitSelectMode() {
    selectMode = false;
    selectedFiles.clear();
    updateSelectUI();
    renderItems(allItems);
}

// ========================================
// Context menu (long press)
// ========================================
function showContextMenu(item, e) {
    if (navigator.vibrate) navigator.vibrate(30);

    var actions = [];
    if (!item.isDir) {
        actions.push({ label: t('files.download'), action: function() { downloadFile(item.path); } });
        actions.push({ label: t('files.qrShare'), action: function() { shareFile(item.path); } });
    }
    actions.push({ label: t('files.copyPath'), action: function() {
        navigator.clipboard.writeText(item.path).then(function() {
            window.showToast && window.showToast(t('files.pathCopied'));
        });
    }});
    if (item.isDir) {
        var favLabel = isFavorite(item.path) ? t('files.removeFavorite') : t('files.addFavorite');
        actions.push({ label: favLabel, action: function() {
            toggleFavorite(item.path);
            window.showToast && window.showToast(isFavorite(item.path) ? t('files.favoriteAdded') : t('files.favoriteRemoved'));
        }});
    }
    if (!item.isDir) {
        actions.push({ label: t('files.selectMode'), action: function() { enterSelectMode(); } });
    }

    actions.push({ label: t('common.cancel'), style: 'cancel' });
    window.showConfirm && window.showConfirm(item.name, actions.map(function(a) {
        return { label: a.label, style: a.style || 'secondary', action: a.action };
    }));
}

// ========================================
// Download
// ========================================
function downloadFile(path) {
    var a = document.createElement('a');
    a.href = '/api/files/download?path=' + encodeURIComponent(path);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function downloadZip() {
    if (selectedFiles.size === 0) return;
    var paths = Array.from(selectedFiles);
    fetch('/api/files/zip', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: paths })
    }).then(function(r) {
        if (!r.ok) throw new Error('zip failed');
        return r.blob();
    }).then(function(blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'files.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        exitSelectMode();
    }).catch(function() {
        window.showToast && window.showToast(t('files.zipFailed'));
    });
}

// ========================================
// Share (QR code)
// ========================================
function shareFile(path) {
    fetch('/api/files/share', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path })
    }).then(function(r) { return r.json(); })
    .then(function(data) {
        showQRModal(data.url, data.name);
    }).catch(function() {
        window.showToast && window.showToast(t('files.shareFailed'));
    });
}

function showQRModal(url, name) {
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url);

    var overlay = document.createElement('div');
    overlay.className = 'files-qr-overlay';
    overlay.innerHTML =
        '<div class="files-qr-modal">' +
        '<div class="files-qr-title">' + escHtml(name) + '</div>' +
        '<img class="files-qr-img" src="' + qrUrl + '" alt="QR">' +
        '<div class="files-qr-url">' + escHtml(url) + '</div>' +
        '<div class="files-qr-note">' + escHtml(t('files.qrOneTime')) + '</div>' +
        '<div class="files-qr-actions">' +
        '<button class="files-qr-btn" id="qr-copy-btn">' + escHtml(t('files.copy')) + '</button>' +
        '<button class="files-qr-btn cancel" id="qr-close-btn">' + escHtml(t('common.close')) + '</button>' +
        '</div></div>';

    document.body.appendChild(overlay);

    overlay.querySelector('#qr-copy-btn').addEventListener('click', function() {
        navigator.clipboard.writeText(url).then(function() {
            window.showToast && window.showToast(t('files.urlCopied'));
        });
    });
    overlay.querySelector('#qr-close-btn').addEventListener('click', function() {
        overlay.remove();
    });
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });
}

// ========================================
// Preview (text / image)
// ========================================
function openPreview(item) {
    filesListView.style.display = 'none';
    filesPreviewView.style.display = 'flex';
    previewTitle.textContent = item.name;
    previewBody.innerHTML = '<div class="files-loading">' + escHtml(t('common.loading')) + '</div>';

    var imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
    if (imageExts.indexOf(item.ext) !== -1) {
        previewBody.innerHTML = '<div class="files-img-wrap"><img class="files-preview-img" src="/api/files/preview?path=' +
            encodeURIComponent(item.path) + '" alt="' + escHtml(item.name) + '"></div>';
        setupPreviewActions(item, 'image');
        return;
    }

    fetch('/api/files/preview?path=' + encodeURIComponent(item.path), { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.type === 'text') {
                var pre = document.createElement('pre');
                pre.className = 'files-preview-text';
                pre.textContent = data.content;
                previewBody.innerHTML = '';
                previewBody.appendChild(pre);
                setupPreviewActions(item, 'text', data.content);
            } else {
                previewBody.innerHTML = '<div class="files-binary-info">' +
                    '<span class="files-binary-icon">' + getIcon(item) + '</span>' +
                    '<div>' + escHtml(item.name) + '</div>' +
                    '<div class="files-binary-size">' + formatSize(item.size) + '</div>' +
                    '</div>';
                setupPreviewActions(item, 'binary');
            }
        })
        .catch(function() {
            previewBody.innerHTML = '<div class="files-binary-info">' +
                '<div>' + escHtml(t('files.previewUnavailable')) + '</div>' +
                '</div>';
            setupPreviewActions(item, 'binary');
        });
}

function setupPreviewActions(item, type, content) {
    var footer = document.getElementById('files-preview-footer');
    footer.innerHTML = '';

    var dlBtn = document.createElement('button');
    dlBtn.className = 'files-action-btn';
    dlBtn.textContent = t('files.download');
    dlBtn.addEventListener('click', function() { downloadFile(item.path); });
    footer.appendChild(dlBtn);

    var shareBtn = document.createElement('button');
    shareBtn.className = 'files-action-btn secondary';
    shareBtn.textContent = t('files.qrShare');
    shareBtn.addEventListener('click', function() { shareFile(item.path); });
    footer.appendChild(shareBtn);

    if (type === 'text') {
        var editBtn = document.createElement('button');
        editBtn.className = 'files-action-btn secondary';
        editBtn.textContent = t('files.edit');
        editBtn.addEventListener('click', function() {
            openEditor(item, content);
        });
        footer.appendChild(editBtn);
    }
}

// ========================================
// Text editor
// ========================================
function openEditor(item, content) {
    previewBody.innerHTML = '';
    var textarea = document.createElement('textarea');
    textarea.className = 'files-edit-textarea';
    textarea.value = content;
    previewBody.appendChild(textarea);

    var footer = document.getElementById('files-preview-footer');
    footer.innerHTML = '';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'files-action-btn';
    saveBtn.textContent = t('files.saveFile');
    saveBtn.addEventListener('click', function() {
        fetch('/api/files/edit', {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: item.path, content: textarea.value })
        }).then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                window.showToast && window.showToast(t('files.fileSaved'));
                content = textarea.value;
            } else {
                window.showToast && window.showToast(t('files.saveFailed') + ': ' + (data.error || ''));
            }
        });
    });
    footer.appendChild(saveBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'files-action-btn secondary';
    cancelBtn.textContent = t('common.cancel');
    cancelBtn.addEventListener('click', function() {
        openPreview(item);
    });
    footer.appendChild(cancelBtn);
}

// ========================================
// Upload
// ========================================
function triggerUpload() {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', function() {
        if (!input.files || input.files.length === 0) return;
        var targetDir = currentPath || '';
        var pending = input.files.length;
        var uploaded = 0;

        Array.from(input.files).forEach(function(file) {
            var formData = new FormData();
            formData.append('file', file);
            formData.append('dir', targetDir);

            fetch('/api/files/upload', {
                method: 'POST', credentials: 'same-origin',
                body: formData
            }).then(function(r) { return r.json(); })
            .then(function(data) {
                uploaded++;
                pending--;
                if (pending === 0) {
                    window.showToast && window.showToast(t('files.uploadComplete', { n: uploaded }));
                    loadDirectory(currentPath);
                }
            }).catch(function() {
                pending--;
                if (pending === 0) loadDirectory(currentPath);
            });
        });
    });
    input.click();
}

// ========================================
// Filter
// ========================================
function applyFilter(query) {
    if (!query) {
        renderItems(allItems);
        return;
    }
    var q = query.toLowerCase();
    var filtered = allItems.filter(function(item) {
        return item.name.toLowerCase().indexOf(q) !== -1;
    });
    renderItems(filtered);
}

// ========================================
// Back to list from preview
// ========================================
function backToList() {
    filesPreviewView.style.display = 'none';
    filesListView.style.display = 'flex';
}

// ========================================
// Init
// ========================================
export function initFiles() {
    resolveDOM();
    loadFavorites();

    window._filesDownload = downloadFile;

    previewBackBtn.addEventListener('click', backToList);

    var filterTimer = null;
    filterInput.addEventListener('input', function() {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(function() {
            applyFilter(filterInput.value.trim());
        }, 200);
    });

    document.getElementById('files-home-btn').addEventListener('click', function() { loadDirectory(''); });
    document.getElementById('files-recent-btn').addEventListener('click', function() { loadRecent(); });
    document.getElementById('files-up-btn').addEventListener('click', function() {
        if (currentPath) {
            var parent = currentPath.split('/').slice(0, -1).join('/') || '/';
            loadDirectory(parent);
        }
    });
    document.getElementById('files-upload-btn').addEventListener('click', triggerUpload);
    document.getElementById('files-refresh-btn').addEventListener('click', function() {
        if (currentPath) {
            loadDirectory(currentPath);
        } else {
            loadRecent();
        }
    });

    document.getElementById('files-select-cancel').addEventListener('click', exitSelectMode);
    document.getElementById('files-select-zip').addEventListener('click', downloadZip);
}

export function loadFiles(done) {
    loadRecent(done);
}

export function setViewSwitcher(fn) {
    viewSwitcherFn = fn;
}
