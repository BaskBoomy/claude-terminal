// preview.js — Multi-tab browser preview (ES module)
import { t } from './i18n.js';

let browserTabs = []; // [{id, url, label, history: string[], historyIndex: number}]
let activeTabId = null;
let tabIdCounter = 0;
let recentUrls = [];
let bookmarks = [];
var VIEWPORTS = ['mobile', 'tablet', 'desktop'];
var VIEWPORT_WIDTHS = { mobile: 0, tablet: 768, desktop: 1280 };
var VIEWPORT_LABELS = { mobile: 'M', tablet: 'Tab', desktop: 'PC' };
var currentViewport = 'mobile';

// DOM refs
let previewUrlInput, previewReload, previewOpen, previewClear;
let previewBack, previewForward, viewportToggle, previewBookmark;
let previewMore, previewMoreMenu;
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
    return url || t('preview.newTab');
  }
}

function applyViewport() {
  var containerWidth = previewFrames.clientWidth;
  var containerHeight = previewFrames.clientHeight;
  var targetWidth = VIEWPORT_WIDTHS[currentViewport];

  previewFrames.querySelectorAll('.preview-iframe').forEach(function (f) {
    if (!targetWidth || targetWidth <= containerWidth) {
      // Mobile (native) — no scaling
      f.style.width = '100%';
      f.style.height = '100%';
      f.style.transform = '';
    } else {
      // Scale down: render at targetWidth, shrink to fit
      var scale = containerWidth / targetWidth;
      f.style.width = targetWidth + 'px';
      f.style.height = (containerHeight / scale) + 'px';
      f.style.transform = 'scale(' + scale + ')';
    }
  });
  if (viewportToggle) {
    viewportToggle.textContent = VIEWPORT_LABELS[currentViewport];
    viewportToggle.classList.toggle('active', currentViewport !== 'mobile');
  }
}

function updateNavButtons() {
  var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
  if (!tab) {
    if (previewBack) previewBack.disabled = true;
    if (previewForward) previewForward.disabled = true;
    return;
  }
  if (previewBack) previewBack.disabled = tab.historyIndex <= 0;
  if (previewForward) previewForward.disabled = tab.historyIndex >= tab.history.length - 1;
}

function navigateWithoutHistory(tab, url) {
  tab.url = url;
  tab.label = labelFromUrl(url);
  previewUrlInput.value = url;
  var iframe = document.getElementById(tab.id);
  if (iframe) iframe.src = url;
  renderBrowserTabs();
  saveBrowserTabs();
  updateNavButtons();
}

function saveRecentUrl(url) {
  if (!url) return;
  recentUrls = recentUrls.filter(function (u) { return u !== url; });
  recentUrls.unshift(url);
  if (recentUrls.length > 10) recentUrls = recentUrls.slice(0, 10);
  try { localStorage.setItem('preview-recent-urls', JSON.stringify(recentUrls)); } catch (e) { /* ignore */ }
}

function saveBookmarks() {
  try { localStorage.setItem('preview-bookmarks', JSON.stringify(bookmarks)); } catch (e) { /* ignore */ }
}

function toggleBookmark(url) {
  if (!url) return;
  var idx = bookmarks.indexOf(url);
  if (idx >= 0) {
    bookmarks.splice(idx, 1);
  } else {
    bookmarks.unshift(url);
  }
  saveBookmarks();
  updateBookmarkBtn();
}

function updateBookmarkBtn() {
  if (!previewBookmark) return;
  var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
  var url = tab ? tab.url : '';
  var isBookmarked = url && bookmarks.indexOf(url) >= 0;
  previewBookmark.innerHTML = isBookmarked ? '&#x2605;' : '&#x2606;';
  previewBookmark.classList.toggle('bookmarked', isBookmarked);
}

export function saveBrowserTabs() {
  var data = browserTabs.map(function (tb) { return { url: tb.url, label: tb.label }; });
  try {
    localStorage.setItem('browser-tabs', JSON.stringify(data));
    localStorage.setItem('browser-active-idx', String(browserTabs.findIndex(function (tb) { return tb.id === activeTabId; })));
  } catch (e) { /* ignore */ }
}

export function renderBrowserTabs() {
  // Remove existing tab buttons (keep the + button)
  browserTabsBar.querySelectorAll('.browser-tab').forEach(function (el) { el.remove(); });
  browserTabs.forEach(function (tab) {
    var btn = document.createElement('button');
    btn.className = 'browser-tab' + (tab.id === activeTabId ? ' active' : '');
    btn.dataset.tabId = tab.id;

    var label = document.createElement('span');
    label.className = 'browser-tab-label';
    label.textContent = tab.label || t('preview.newTab');
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
  browserTabsBar.querySelectorAll('.browser-tab').forEach(function (el) {
    el.classList.toggle('active', el.dataset.tabId === id);
  });
  // Update address bar
  var tab = browserTabs.find(function (tb) { return tb.id === id; });
  previewUrlInput.value = tab ? tab.url : '';
  saveBrowserTabs();
  updateNavButtons();
  updateBookmarkBtn();
}

export function createBrowserTab(url, skipSave) {
  var id = 'btab-' + (++tabIdCounter);
  var fullUrl = url ? ensureProtocol(url) : '';
  var tab = { id: id, url: fullUrl, label: labelFromUrl(fullUrl) || 'New Tab', history: fullUrl ? [fullUrl] : [], historyIndex: fullUrl ? 0 : -1 };
  browserTabs.push(tab);

  // Create iframe
  var iframe = document.createElement('iframe');
  iframe.className = 'preview-iframe';
  iframe.id = id;
  if (fullUrl) iframe.src = fullUrl;
  iframe.addEventListener('load', function () {
    var tb = browserTabs.find(function (bt) { return bt.id === id; });
    if (!tb) return;
    try {
      var newUrl = iframe.contentWindow.location.href;
      if (newUrl && newUrl !== 'about:blank' && newUrl !== tb.url) {
        tb.url = newUrl;
        tb.label = labelFromUrl(newUrl);
        // Push to history if navigated within iframe
        tb.history = tb.history.slice(0, tb.historyIndex + 1);
        tb.history.push(newUrl);
        tb.historyIndex = tb.history.length - 1;
        if (id === activeTabId) {
          previewUrlInput.value = newUrl;
          updateNavButtons();
          updateBookmarkBtn();
        }
        renderBrowserTabs();
        saveBrowserTabs();
      }
    } catch (e) { /* cross-origin — ignore */ }
  });
  previewFrames.appendChild(iframe);

  if (fullUrl) saveRecentUrl(fullUrl);
  renderBrowserTabs();
  activateBrowserTab(id);
  applyViewport();
  if (!skipSave) saveBrowserTabs();
  return tab;
}

export function closeBrowserTab(id) {
  var idx = browserTabs.findIndex(function (tb) { return tb.id === id; });
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
  var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
  if (!tab) return;
  // Truncate forward history and push new URL
  tab.history = tab.history.slice(0, tab.historyIndex + 1);
  tab.history.push(url);
  tab.historyIndex = tab.history.length - 1;
  tab.url = url;
  tab.label = labelFromUrl(url);
  previewUrlInput.value = url;
  var iframe = document.getElementById(activeTabId);
  if (iframe) iframe.src = url;
  saveRecentUrl(url);
  renderBrowserTabs();
  saveBrowserTabs();
  updateNavButtons();
  updateBookmarkBtn();
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

function makeDropdownItem(url, removable, onRemove) {
  var item = document.createElement('div');
  item.className = 'url-dropdown-item';
  var text = document.createElement('span');
  text.className = 'url-dropdown-text';
  text.textContent = url;
  item.appendChild(text);
  if (removable && onRemove) {
    var del = document.createElement('button');
    del.className = 'url-dropdown-del';
    del.innerHTML = '&times;';
    del.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onRemove(url);
      renderPreviewDropdown();
    });
    item.appendChild(del);
  }
  item.addEventListener('mousedown', function (e) {
    e.preventDefault();
    navigateActiveTab(url);
  });
  return item;
}

function renderStaticDropdown() {
  previewDropdown.innerHTML = '';
  var current = previewUrlInput.value;
  var bm = bookmarks.filter(function (u) { return u !== current; });
  var recent = recentUrls.filter(function (u) { return u !== current && bookmarks.indexOf(u) < 0; });
  if (bm.length > 0) {
    var sec = document.createElement('div');
    sec.className = 'url-dropdown-section';
    sec.textContent = t('preview.bookmarks');
    previewDropdown.appendChild(sec);
    bm.forEach(function (url) {
      previewDropdown.appendChild(makeDropdownItem(url, true, function (u) {
        bookmarks = bookmarks.filter(function (b) { return b !== u; });
        saveBookmarks();
        updateBookmarkBtn();
      }));
    });
  }
  if (recent.length > 0) {
    var sec2 = document.createElement('div');
    sec2.className = 'url-dropdown-section';
    sec2.textContent = t('preview.recent');
    previewDropdown.appendChild(sec2);
    recent.forEach(function (url) {
      previewDropdown.appendChild(makeDropdownItem(url, false));
    });
  }
}

function openPreviewDropdown() {
  renderStaticDropdown();
  if (previewDropdown.children.length > 0) {
    previewDropdown.classList.add('open');
  }
}

function closeMoreMenu() {
  if (previewMoreMenu) previewMoreMenu.classList.remove('open');
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
  previewBack = document.getElementById('preview-back');
  previewForward = document.getElementById('preview-forward');
  viewportToggle = document.getElementById('viewport-toggle');
  previewBookmark = document.getElementById('preview-bookmark');
  previewMore = document.getElementById('preview-more');
  previewMoreMenu = document.getElementById('preview-more-menu');
  previewDropdown = document.getElementById('preview-url-dropdown');
  previewFrames = document.getElementById('preview-frames');
  browserTabsBar = document.getElementById('browser-tabs');
  browserTabAdd = document.getElementById('browser-tab-add');

  // Load recent URLs and bookmarks from storage
  try { recentUrls = JSON.parse(localStorage.getItem('preview-recent-urls') || '[]'); } catch (e) { recentUrls = []; }
  try { bookmarks = JSON.parse(localStorage.getItem('preview-bookmarks') || '[]'); } catch (e) { bookmarks = []; }

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

  // Bookmark button
  previewBookmark.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
    if (tab && tab.url) toggleBookmark(tab.url);
  });

  // Reload button
  previewReload.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
    if (tab && tab.url) {
      var iframe = document.getElementById(activeTabId);
      if (iframe) iframe.src = tab.url;
    }
  });

  // Clear cookies & reload — destroy iframe and recreate
  previewClear.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
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
    if (typeof window.showToast === 'function') window.showToast(t('preview.sessionCleared'));
  });

  // Open in new window
  previewOpen.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
    if (tab && tab.url) window.open(tab.url, '_blank');
  });

  // Back/Forward buttons
  previewBack.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
    if (!tab || tab.historyIndex <= 0) return;
    tab.historyIndex--;
    navigateWithoutHistory(tab, tab.history[tab.historyIndex]);
  });
  previewForward.addEventListener('click', function (e) {
    e.preventDefault();
    var tab = browserTabs.find(function (tb) { return tb.id === activeTabId; });
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex++;
    navigateWithoutHistory(tab, tab.history[tab.historyIndex]);
  });

  // Viewport toggle — cycle: mobile → tablet → desktop
  viewportToggle.addEventListener('click', function (e) {
    e.preventDefault();
    var idx = VIEWPORTS.indexOf(currentViewport);
    currentViewport = VIEWPORTS[(idx + 1) % VIEWPORTS.length];
    applyViewport();
    viewportToggle.textContent = t('preview.viewport').replace('M', VIEWPORT_LABELS[currentViewport]);
    closeMoreMenu();
  });

  // More menu toggle
  previewMore.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    previewMoreMenu.classList.toggle('open');
  });
  // Close more menu on outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#preview-more-menu') && !e.target.closest('#preview-more')) {
      closeMoreMenu();
    }
  });
  // Close more menu after any menu item click
  previewMoreMenu.querySelectorAll('.preview-menu-item').forEach(function (item) {
    if (item.id === 'viewport-toggle') return; // handled separately
    item.addEventListener('click', function () {
      closeMoreMenu();
    });
  });

  // Recent URL dropdown — focus/blur
  previewUrlInput.addEventListener('focus', openPreviewDropdown);
  previewUrlInput.addEventListener('blur', function () {
    setTimeout(closePreviewDropdown, 150);
  });
}
