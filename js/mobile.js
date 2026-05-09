// Mobile bottom-dock controller. The dock is purely CSS-driven: clicking
// a tab adds a `mobile-{name}` class to <body>, which the stylesheet uses
// to surface the matching panel as a slide-up bottom sheet. Tapping the
// active tab again, or tapping the canvas, dismisses the sheet.
//
// On desktop the dock is hidden via `@media`, so this controller silently
// does nothing — none of the click bindings cause harm without the dock.

import { canvas } from './scene.js';

const TABS = ['ctrl', 'nav', 'view', 'info', 'edit'];

function _clearAll() {
  for (const t of TABS) document.body.classList.remove(`mobile-${t}`);
  for (const b of document.querySelectorAll('.mobile-tab')) b.classList.remove('active');
}

function _activate(panel) {
  const wasActive = document.body.classList.contains(`mobile-${panel}`);
  _clearAll();
  if (!wasActive) {
    document.body.classList.add(`mobile-${panel}`);
    const btn = document.querySelector(`.mobile-tab[data-panel="${panel}"]`);
    if (btn) btn.classList.add('active');
  }
}

export function initMobileDock() {
  const dock = document.getElementById('mobileDock');
  if (!dock) return;

  dock.addEventListener('click', e => {
    const btn = e.target.closest('.mobile-tab');
    if (!btn) return;
    e.stopPropagation();
    _activate(btn.dataset.panel);
  });

  // Tap on the canvas dismisses any open sheet so the user can swipe
  // back to the scene without having to find the tab again. The canvas
  // click handler still runs for body-pick / aim-spawn.
  canvas.addEventListener('click', () => {
    if ([...document.body.classList].some(c => c.startsWith('mobile-'))) {
      _clearAll();
    }
  }, { capture: false });

  // Escape clears too, in case a hardware keyboard is attached.
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if ([...document.body.classList].some(c => c.startsWith('mobile-'))) {
        _clearAll();
      }
    }
  });
}
