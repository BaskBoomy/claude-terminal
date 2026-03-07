// preview.js — Multi-tab browser preview (ES module)

let browserTabs = []; // [{id, url, label}]
let activeTabId = null;
let tabIdCounter = 0;
let recentUrls = [];

// DOM refs
let previewUrlInput, previewReload, previewOpen, previewClear;
let previewDropdown, previewFrames, browserTabsBar, browserTabAdd;

function ensureProtocol(url) {
  if (!url) return url;
  return /^https?:\/\//i.test(url) ? url : 'https://' + url;
}

function labelFromUrl(url) {
  try {
    var h = new URL(url).hostname;
    return h.replace(/^www\./, '') || url;
  } catch (e) {
    return url || 'New Tab';
  }
}

function saveRecentUrl(url) {
  if (!url) return;
  recentUrls = recentUrls.filter(function (u) { return u !== url; });
  recentUrls.unshift(url);
  if (recentUrls.length > 10) recentUrls = recentUrls.slice(0, 10);
  try { localStorage.setItem('preview-recent-urls', JSON.stringify(recentUrls)); } catch (e) { /* ignore */ }
}

export function saveBrowserTabs() {
  var data = browserTabs.map(function (t) { return { url: t.url, label: t.label }; });
  try {
    localStorage.setItem('browser-tabs', JSON.stringify(data));
    localStorage.setItem('browser-active-idx', String(browserTabs.findIndex(function (t) { return t.id === activeTabId; })));
  } catch (e) { /* ignore */ }
}

export function renderBrowserTabs() {
  // Remove existing tab buttons (keep the + button)
  browserTabsBar.querySelectorAll('.browser-tab').forEach(function (t) { t.remove(); });
  browserTabs.forEach(function (tab) {
    var btn = document.createElement('button');
    btn.className = 'browser-tab' + (tab.id === activeTabId ? ' active' : '');
    btn.dataset.tabId = tab.id;

    var label = document.createElement('span');
    label.className = 'browser-tab-label';
    label.textContent = tab.label || 'New Tab';
    btn.appendChild(label);

    var closeBtn = document.createElement('span');
    closeBtn.className = 'browser-tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeBrowserTab(tab.id);
    });
    btn.appendChild(closeBtn);

    btn.addEventListener('click', function () {
      activateBrowserTab(tab.id);
    });

    browserTabsBar.insertBefore(btn, browserTabAdd);
  });
}

export function activateBrowserTab(id) {
  activeTabId = id;
  // Show/hide iframes
  previewFrames.querySelectorAll('.preview-iframe').forEach(function (f) {
    f.classList.toggle('active', f.id === id);
  });
  // Update tab bar active state
  browserTabsBar.querySelectorAll('.browser-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.tabId === id);
  });
  // Update address bar
  var tab = browserTabs.find(function (t) { return t.id === id; });
  previewUrlInput.value = tab ? tab.url : '';
  saveBrowserTabs();
}

export function createBrowserTab(url, skipSave) {
  var id = 'btab-' + (++tabIdCounter);
  var fullUrl = url ? ensureProtocol(url) : '';
  var tab = { id: id, url: fullUrl, label: labelFromUrl(fullUrl) || 'New Tab' };
  browserTabs.push(tab);

  // Create iframe
  var iframe = document.createElement('iframe');
  iframe.className = 'preview-iframe';
  iframe.id = id;
  if (fullUrl) iframe.src = fullUrl;
  previewFrames.appendChild(iframe);

  if (fullUrl) saveRecentUrl(fullUrl);
  renderBrowserTabs();
  activateBrowserTab(id);
  if (!skipSave) saveBrowserTabs();
  return tab;
}

export function closeBrowserTab(id) {
  var idx = browserTabs.findIndex(function (t) { return t.id === id; });
  if (idx === -1) return;
  browserTabs.splice(idx, 1);
  var iframe = document.getElementById(id);
  if (iframe) iframe.remove();

  if (browserTabs.length === 0) {
    // Create a fresh empty tab
    createBrowserTab('');
    return;
  }
  if (activeTabId === id) {
    var nextIdx = Math.min(idx, browserTabs.length - 1);
    activateBrowserTab(browserTabs[nextIdx].id);
  }
  renderBrowserTabs();
  saveBrowserTabs();
}

export function navigateActiveTab(url) {
  if (!url) return;
  url = ensureProtocol(url);
  var tab = browserTabs.find(function (t) { return t.id === activeTabId; });
  if (!tab) return;
  tab.url = url;
  tab.label = labelFromUrl(url);
  previewUrlInput.value = url;
  var iframe = document.getElementById(activeTabId);
  if (iframe) iframe.src = url;
  saveRecentUrl(url);
  renderBrowserTabs();
  saveBrowserTabs();
  closePreviewDropdown();
}

export function restoreBrowserTabs() {
  var saved = [];
  try { saved = JSON.parse(localStorage.getItem('browser-tabs') || '[]'); } catch (e) { /* ignore */ }
  var savedIdx = parseInt(localStorage.getItem('browser-active-idx') || '0', 10);
  if (saved.length === 0) {
    createBrowserTab('', true);
  } else {
    saved.forEach(function (s) { createBrowserTab(s.url, true); });
    var targetIdx = Math.min(Math.max(savedIdx, 0), browserTabs.length - 1);
    activateBrowserTab(browserTabs[targetIdx].id);
  }
}

// --- Dropdown helpers ---

function renderPreviewDropdown() {
  previewDropdown.innerHTML = '';
  var current = previewUrlInput.value;
  var filtered = recentUrls.filter(function (u) { return u !== current; });
  if (filtered.length === 0) return;
  filtered.forEach(function (url) {
    var item = document.createElement('div');
    item.className = 'url-dropdown-item';
    item.textContent = url;
    item.addEventListener('mousedown', function (e) {
      e.preventDefault();
      navigateActiveTab(url);
    });
    previewDropdown.appendChild(item);
  });
}

function openPreviewDropdown() {
  renderPreviewDropdown();
  if (previewDropdown.children.length > 0) {
    previewDropdown.classList.add('open');
  }
}

function closePreviewDropdown() {
  previewDropdown.classList.remove('open');
}

// --- Initialization ---

export function initPreview() {
  // Acquire DOM refs
  previewUrlInput = document.getElementById('preview-url');
  previewReload = document.getElementById('preview-reload');
  previewOpen = document.getElementById('preview-open');
  previewClear = document.getElementById('preview-clear');
  previewDropdown = document.getElementById('preview-url-dropdown');
  previewFrames = document.getElementById('preview-frames');
  browserTabsBar = document.getElementById('browser-tabs');
  browserTabAdd = document.getElementById('browser-tab-add');

  // Load recent URLs from storage
  try { recentUrls = JSON.parse(localStorage.getItem('preview-recent-urls') || '[]'); } catch (e) { recentUrls = []; }

  // Restore saved tabs or create one empty
  restoreBrowserTabs();

  // + button — add new tab
  browserTabAdd.addEventListener('click', function (e) {
    e.preventDefault();
    createBrowserTab('');
    previewUrlInput.focus();
  });

  // Address bar — Enter to navigate
  previewUrlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateActiveTab(previewUrlInput.value.trim());
      previewUrlInput.blur();
    }
  });

  // Reload button
  previewReload.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (t) { return t.id === activeTabId; });
    if (tab && tab.url) {
      var iframe = document.getElementById(activeTabId);
      if (iframe) iframe.src = tab.url;
    }
  });

  // Clear cookies & reload — destroy iframe and recreate
  previewClear.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (t) { return t.id === activeTabId; });
    if (!tab || !tab.url) return;
    var oldIframe = document.getElementById(activeTabId);
    if (!oldIframe) return;
    // Remove old iframe completely (drops all session/cookie state)
    oldIframe.remove();
    // Create fresh iframe
    var newIframe = document.createElement('iframe');
    newIframe.className = 'preview-iframe active';
    newIframe.id = activeTabId;
    newIframe.src = tab.url;
    previewFrames.appendChild(newIframe);
    if (typeof window.showToast === 'function') window.showToast('Session cleared');
  });

  // Open in new window
  previewOpen.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (t) { return t.id === activeTabId; });
    if (tab && tab.url) window.open(tab.url, '_blank');
  });

  // Recent URL dropdown — focus/blur
  previewUrlInput.addEventListener('focus', openPreviewDropdown);
  previewUrlInput.addEventListener('blur', function () {
    setTimeout(closePreviewDropdown, 150);
  });
}
