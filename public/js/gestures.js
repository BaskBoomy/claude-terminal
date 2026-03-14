/**
 * gestures.js — Touch gesture utilities (ES module)
 *
 * Exports:
 *   initGestures()                        — edge double-tap tab switching + popstate trap
 *   setupPullToRefresh(scrollEl, onRefresh) — pull-to-refresh on a scrollable element
 *   initTabDragDrop(tabsContainer, onReorder) — touch-based tab reordering with FLIP
 *   initTouchScroll(frame)                — touch scrolling for terminal iframe
 */

import { t } from './i18n.js';
import { isMobile } from './utils.js';

// ─── Edge Double-Tap + Popstate Trap ─────────────────────────────────────────

// Shared edge double-tap state (used by both document listener and iframe listener)
var _edgeTap = { time: 0, side: null };
var _edgeCallback = null;
var EDGE_WIDTH = 50;
var EDGE_DOUBLE_TAP_MS = 300;
var EDGE_TAP_THRESHOLD = 10;

// Core double-tap check — called from document listener and iframe listener.
// All coordinates must be in parent window space.
function _checkEdgeDoubleTap(endX, endY) {
  var side = null;
  if (endX < EDGE_WIDTH) side = 'left';
  else if (endX > window.innerWidth - EDGE_WIDTH) side = 'right';
  if (!side) { _edgeTap = { time: 0, side: null }; return; }

  // Skip taps in bottom UI areas
  var bottomIds = ['input-bar', 'toolbar', 'keys-bar'];
  for (var i = 0; i < bottomIds.length; i++) {
    var area = document.getElementById(bottomIds[i]);
    if (area && area.offsetParent !== null) {
      var r = area.getBoundingClientRect();
      if (r.height > 0 && endY >= r.top) return;
    }
  }

  var now = Date.now();
  if (side === _edgeTap.side && now - _edgeTap.time < EDGE_DOUBLE_TAP_MS) {
    _edgeTap = { time: 0, side: null };
    if (_edgeCallback) {
      _edgeCallback(side === 'right' ? 'next' : 'prev');
    }
  } else {
    _edgeTap = { time: now, side: side };
  }
}

export function initGestures(opts) {
  if (isMobile) {
    _edgeCallback = (opts && opts.onEdgeDoubleTap) || null;
    _initDocEdgeListener();
    _initPopstateTrap();
  }
}

// Document-level passive listener — handles all taps EXCEPT inside iframes.
function _initDocEdgeListener() {
  var startX = 0, startY = 0;

  document.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true, capture: true });

  document.addEventListener('touchend', function(e) {
    var t = e.changedTouches[0];
    if (Math.abs(t.clientX - startX) >= EDGE_TAP_THRESHOLD ||
        Math.abs(t.clientY - startY) >= EDGE_TAP_THRESHOLD) return;
    _checkEdgeDoubleTap(t.clientX, t.clientY);
  }, { passive: true, capture: true });
}

function _initPopstateTrap() {
  var pushed = false;

  function pushGuard() {
    if (!pushed) {
      pushed = true;
      history.pushState({ _noBack: 1 }, '', location.href);
    }
  }

  ['touchstart', 'click', 'keydown'].forEach(function (evt) {
    document.addEventListener(evt, pushGuard, { once: true });
  });

  window.addEventListener('popstate', function () {
    history.pushState({ _noBack: 1 }, '', location.href);
  });
}

// ─── Pull to Refresh ─────────────────────────────────────────────────────────

/**
 * Attach a pull-to-refresh gesture to a scrollable element.
 *
 * @param {HTMLElement} scrollEl   — the scrollable container
 * @param {(done: () => void) => void} onRefresh — called when user pulls far enough;
 *        invoke `done()` when the refresh work is complete.
 */
export function setupPullToRefresh(scrollEl, onRefresh) {
  if (!scrollEl) return;

  scrollEl.style.overscrollBehaviorY = 'contain';

  // Reuse existing indicator if present (survives innerHTML clears via data-ptr)
  var indicator = scrollEl.querySelector('[data-ptr]');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'ptr-indicator';
    indicator.setAttribute('data-ptr', '');
    indicator.innerHTML =
      '<div class="ptr-spinner"></div><span>' + t('gestures.pullToRefresh') + '</span>';
    scrollEl.prepend(indicator);
  }

  var startY = 0;
  var pulling = false;
  var refreshing = false;

  scrollEl.addEventListener('touchstart', function (e) {
    if (refreshing) return;
    if (scrollEl.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  scrollEl.addEventListener('touchmove', function (e) {
    if (!pulling || refreshing) return;

    // Re-check: indicator might have been removed by innerHTML clear
    indicator = scrollEl.querySelector('[data-ptr]');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'ptr-indicator';
      indicator.setAttribute('data-ptr', '');
      indicator.innerHTML =
        '<div class="ptr-spinner"></div><span>' + t('gestures.pullToRefresh') + '</span>';
      scrollEl.prepend(indicator);
    }

    var dy = e.touches[0].clientY - startY;

    if (dy > 0 && scrollEl.scrollTop <= 0) {
      e.preventDefault();
      var pull = Math.min(dy, 120);
      indicator.style.height = pull + 'px';
      indicator.style.opacity = Math.min(pull / 60, 1);
      indicator.classList.add('visible');
    } else {
      _hideIndicator(indicator);
    }
  }, { passive: false }); // MUST be non-passive to allow preventDefault

  scrollEl.addEventListener('touchend', function () {
    if (!pulling || refreshing) return;
    pulling = false;

    indicator = scrollEl.querySelector('[data-ptr]');
    if (!indicator) return;

    var height = parseInt(indicator.style.height, 10) || 0;

    if (height > 60) {
      // Trigger refresh
      refreshing = true;
      indicator.style.height = '50px';
      indicator.style.opacity = '1';
      indicator.classList.add('refreshing');
      var span = indicator.querySelector('span');
      if (span) span.textContent = t('gestures.refreshing');

      onRefresh(function done() {
        setTimeout(function () {
          refreshing = false;
          _hideIndicator(indicator);
          indicator.classList.remove('refreshing');
          var span = indicator.querySelector('span');
          if (span) span.textContent = t('gestures.pullToRefresh');
        }, 300);
      });
    } else {
      _hideIndicator(indicator);
    }
  }, { passive: true });
}

function _hideIndicator(indicator) {
  if (!indicator) return;
  indicator.style.height = '0';
  indicator.style.opacity = '0';
  indicator.classList.remove('visible');
}

// ─── Tab Drag & Drop (touch-based with FLIP animation) ──────────────────────

/**
 * Enable touch-based drag-and-drop reordering on tabs.
 *
 * @param {HTMLElement} tabsContainer — the container holding tab elements
 * @param {(newOrder: string[]) => void} onReorder — called with array of tab ids
 *        in their new order after a successful drag
 */
export function initTabDragDrop(tabsContainer, onReorder) {
  if (!tabsContainer) return;

  var HOLD_DURATION = 250; // ms hold before drag starts
  var holdTimer = null;
  var dragging = false;
  var ghost = null;
  var draggedTab = null;
  var startX = 0;
  var startY = 0;

  tabsContainer.addEventListener('touchstart', function (e) {
    var tab = _closestTab(e.target, tabsContainer);
    if (!tab) return;

    var touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    draggedTab = tab;

    holdTimer = setTimeout(function () {
      _startDrag(tab, touch);
    }, HOLD_DURATION);
  }, { passive: true });

  tabsContainer.addEventListener('touchmove', function (e) {
    if (!dragging) {
      // Cancel hold if moved before hold duration
      var touch = e.touches[0];
      var dx = Math.abs(touch.clientX - startX);
      var dy = Math.abs(touch.clientY - startY);
      if (dx > 5 || dy > 5) {
        clearTimeout(holdTimer);
      }
      return;
    }

    e.preventDefault();
    var touch = e.touches[0];
    _moveDrag(touch);
  }, { passive: false });

  tabsContainer.addEventListener('touchend', _endDrag, { passive: true });
  tabsContainer.addEventListener('touchcancel', _endDrag, { passive: true });

  function _startDrag(tab, touch) {
    dragging = true;
    tab.classList.add('dragging');

    // Create ghost element
    ghost = tab.cloneNode(true);
    ghost.classList.add('tab-ghost');
    var rect = tab.getBoundingClientRect();
    ghost.style.cssText =
      'position:fixed;z-index:10000;pointer-events:none;opacity:0.85;' +
      'left:' + rect.left + 'px;top:' + rect.top + 'px;' +
      'width:' + rect.width + 'px;height:' + rect.height + 'px;';
    document.body.appendChild(ghost);
  }

  function _moveDrag(touch) {
    if (!ghost || !draggedTab) return;

    // Position ghost at touch point
    var gw = ghost.offsetWidth;
    var gh = ghost.offsetHeight;
    ghost.style.left = (touch.clientX - gw / 2) + 'px';
    ghost.style.top = (touch.clientY - gh / 2) + 'px';

    // Determine drop target
    var tabs = _getTabs(tabsContainer);
    var dropIndex = -1;

    for (var i = 0; i < tabs.length; i++) {
      var rect = tabs[i].getBoundingClientRect();
      var midX = rect.left + rect.width / 2;
      if (touch.clientX < midX) {
        dropIndex = i;
        break;
      }
    }
    if (dropIndex === -1) dropIndex = tabs.length;

    // FLIP animation: record initial positions
    var firstRects = {};
    tabs.forEach(function (t) {
      firstRects[_tabId(t)] = t.getBoundingClientRect();
    });

    // Reorder in DOM
    var currentIndex = tabs.indexOf(draggedTab);
    if (currentIndex !== -1 && dropIndex !== currentIndex && dropIndex !== currentIndex + 1) {
      if (dropIndex >= tabs.length) {
        tabsContainer.appendChild(draggedTab);
      } else {
        var ref = tabs[dropIndex];
        if (ref === draggedTab) return;
        tabsContainer.insertBefore(draggedTab, ref);
      }

      // FLIP: record final positions and animate
      var updatedTabs = _getTabs(tabsContainer);
      updatedTabs.forEach(function (t) {
        var id = _tabId(t);
        if (!firstRects[id]) return;
        var lastRect = t.getBoundingClientRect();
        var dx = firstRects[id].left - lastRect.left;
        var dy = firstRects[id].top - lastRect.top;
        if (dx === 0 && dy === 0) return;

        t.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        t.style.transition = 'none';

        requestAnimationFrame(function () {
          t.style.transition = 'transform 200ms ease';
          t.style.transform = '';
          t.addEventListener('transitionend', function handler() {
            t.style.transition = '';
            t.removeEventListener('transitionend', handler);
          });
        });
      });
    }
  }

  function _endDrag() {
    clearTimeout(holdTimer);

    if (!dragging) {
      draggedTab = null;
      return;
    }

    dragging = false;

    if (ghost) {
      ghost.remove();
      ghost = null;
    }

    if (draggedTab) {
      draggedTab.classList.remove('dragging');
    }

    // Collect new order and notify
    var tabs = _getTabs(tabsContainer);
    var newOrder = tabs.map(function (t) { return _tabId(t); });
    draggedTab = null;

    if (onReorder) onReorder(newOrder);
  }

  function _closestTab(el, container) {
    while (el && el !== container) {
      if (el.classList && el.classList.contains('browser-tab')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function _getTabs(container) {
    return Array.from(container.querySelectorAll('.browser-tab'));
  }

  function _tabId(tab) {
    return tab.dataset.tabId || tab.id || '';
  }
}

// ─── Touch Scroll for Terminal iframe ────────────────────────────────────────

/**
 * Enable touch-based scrolling over a terminal iframe.
 * Places a transparent overlay that captures vertical swipes and dispatches
 * wheel events to the iframe or scrolls the viewport.
 *
 * @param {HTMLIFrameElement} frame — the terminal iframe element
 */
/**
 * initTouchScroll(frame, callbacks)
 * Attaches to xterm-screen inside the iframe for vertical scroll + horizontal swipe.
 * callbacks: { sendText, sendKey, tmuxCmd }
 * Returns a setup function that retries until xterm-screen is available.
 */
export function initTouchScroll(frame, callbacks) {
  if (!frame) return;

  var scrollIndicator = document.getElementById('scroll-indicator');
  var scrollBottomBtn = document.getElementById('scroll-bottom-btn');
  var scrollFadeTimer = null;

  function showScrollIndicator() {
    if (!scrollIndicator) return;
    scrollIndicator.classList.add('visible');
    clearTimeout(scrollFadeTimer);
    scrollFadeTimer = setTimeout(function() {
      scrollIndicator.classList.remove('visible');
    }, 800);
  }

  function emitScroll(direction) {
    var dispatched = false;
    try {
      var viewport = frame.contentDocument.querySelector('.xterm-viewport');
      if (viewport) {
        viewport.dispatchEvent(new WheelEvent('wheel', {
          deltaY: direction === 'up' ? -100 : 100,
          bubbles: true, cancelable: true
        }));
        dispatched = true;
      }
    } catch(e) {}
    if (!dispatched && callbacks.sendText) {
      if (direction === 'up') callbacks.sendText('\x1b[<64;1;1M');
      else callbacks.sendText('\x1b[<65;1;1M');
    }
    showScrollIndicator();
    if (direction === 'up' && scrollBottomBtn) {
      scrollBottomBtn.classList.add('visible');
    }
  }

  // Scroll-to-bottom button
  if (scrollBottomBtn) {
    scrollBottomBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      // Use server API to safely exit copy-mode (does NOT send keys to running process)
      fetch('/api/tmux-scroll-bottom', { method: 'POST' }).catch(function() {});
      try {
        var viewport = frame.contentDocument.querySelector('.xterm-viewport');
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      } catch(e) {}
      scrollBottomBtn.classList.remove('visible');
    });
  }

  function tryAttach() {
    var xtermScreen = null;
    try {
      xtermScreen = frame.contentDocument.querySelector('.xterm-screen');
    } catch(e) {}
    if (!xtermScreen) return false;

    // Prevent virtual keyboard on terminal touch
    if ('ontouchstart' in window) {
      try {
        var xtermTA = frame.contentDocument.querySelector('.xterm-helper-textarea');
        if (xtermTA) xtermTA.setAttribute('inputmode', 'none');
      } catch(e) {}
    }

    var startX = 0, startY = 0, lastY = 0;
    var isScrolling = false, isSwiping = false, swipeHandled = false;
    var directionLocked = false, accumulated = 0;
    var THRESHOLD = 10, STEP = 30, SWIPE_MIN = 60;

    function animateSwipeTransition(direction) {
      var slideOut = direction === 'left' ? '-100%' : '100%';
      var slideIn  = direction === 'left' ? '60%' : '-60%';
      frame.style.transition = 'transform 150ms ease-in, opacity 100ms ease-in';
      frame.style.transform = 'translateX(' + slideOut + ')';
      frame.style.opacity = '0.3';
      setTimeout(function() {
        if (callbacks.tmuxCmd) {
          if (direction === 'left') callbacks.tmuxCmd('n', 78);
          else callbacks.tmuxCmd('p', 80);
        }
        frame.style.transition = 'none';
        frame.style.transform = 'translateX(' + slideIn + ')';
        requestAnimationFrame(function() {
          frame.style.transition = 'transform 200ms ease-out, opacity 150ms ease-out';
          frame.style.transform = 'translateX(0)';
          frame.style.opacity = '1';
        });
      }, 150);
    }

    xtermScreen.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastY = startY;
      isScrolling = false; isSwiping = false;
      swipeHandled = false; directionLocked = false;
      accumulated = 0;
    }, { passive: true });

    xtermScreen.addEventListener('touchmove', function(e) {
      if (e.touches.length !== 1) return;
      var currentX = e.touches[0].clientX;
      var currentY = e.touches[0].clientY;
      var deltaY = Math.abs(startY - currentY);
      var deltaX = Math.abs(currentX - startX);

      if (!directionLocked && (deltaY > THRESHOLD || deltaX > THRESHOLD)) {
        directionLocked = true;
        isScrolling = deltaY > deltaX;
        isSwiping = !isScrolling;
        lastY = currentY;
      }

      if (isScrolling) {
        e.preventDefault();
        var delta = lastY - currentY;
        accumulated += delta;
        lastY = currentY;
        while (Math.abs(accumulated) >= STEP) {
          if (accumulated > 0) { emitScroll('down'); accumulated -= STEP; }
          else { emitScroll('up'); accumulated += STEP; }
        }
      }

      if (isSwiping && !swipeHandled) {
        var swipeDist = currentX - startX;
        frame.style.transition = 'none';
        frame.style.transform = 'translateX(' + (swipeDist * 0.4) + 'px)';
        if (Math.abs(swipeDist) >= SWIPE_MIN) {
          swipeHandled = true;
          animateSwipeTransition(swipeDist < 0 ? 'left' : 'right');
        }
      }
    }, { passive: false });

    xtermScreen.addEventListener('touchend', function(e) {
      if (isSwiping && !swipeHandled) {
        frame.style.transition = 'transform 200ms ease-out';
        frame.style.transform = 'translateX(0)';
      }
      // Edge double-tap detection for iframe touches
      if (!isScrolling && !isSwiping && e.changedTouches.length === 1) {
        var t = e.changedTouches[0];
        var dx = Math.abs(t.clientX - startX);
        var dy = Math.abs(t.clientY - startY);
        if (dx < THRESHOLD && dy < THRESHOLD) {
          // Convert iframe coords to parent window coords
          var frameRect = frame.getBoundingClientRect();
          _checkEdgeDoubleTap(t.clientX + frameRect.left, t.clientY + frameRect.top);
        }
      }
      isScrolling = false; isSwiping = false;
      swipeHandled = false; directionLocked = false;
      accumulated = 0;
    }, { passive: true });

    return true;
  }

  // Retry attachment after iframe loads
  frame.addEventListener('load', function() {
    var attempts = 0;
    var tryTimer = setInterval(function() {
      if (tryAttach() || ++attempts > 20) clearInterval(tryTimer);
    }, 250);
  });
  // Also try immediately
  tryAttach();
}
