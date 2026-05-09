// Mobile FAB + left-drawer controller. Tapping the floating action
// button toggles the drawer open/closed. While open, the drawer's tab
// strip determines which panel is shown to its right; tapping the
// canvas dismisses the whole drawer so the user can interact with the
// scene without finding the FAB again.
//
// All UI is left-anchored — nothing sits at the bottom of the viewport
// where iOS Safari's URL bar would cover it. The CSS uses
// env(safe-area-inset-*) so the FAB clears the notch / Dynamic Island
// and Earth-Mode panels respect the home indicator.

import { canvas } from './scene.js';

const TABS = ['ctrl', 'nav', 'view', 'info', 'edit'];
const DRAWER_OPEN_CLASS = 'mobile-drawer-open';
const DEFAULT_TAB = 'ctrl';

function _hasMobileTab() {
  for (const t of TABS) if (document.body.classList.contains(`mobile-${t}`)) return true;
  return false;
}

function _clearTabs() {
  for (const t of TABS) document.body.classList.remove(`mobile-${t}`);
  for (const b of document.querySelectorAll('.mobile-drawer-tab')) {
    b.classList.remove('active');
  }
}

function _setActiveTab(panel) {
  _clearTabs();
  document.body.classList.add(`mobile-${panel}`);
  const btn = document.querySelector(`.mobile-drawer-tab[data-panel="${panel}"]`);
  if (btn) btn.classList.add('active');
}

function _openDrawer(initialTab = DEFAULT_TAB) {
  document.body.classList.add(DRAWER_OPEN_CLASS);
  if (!_hasMobileTab()) _setActiveTab(initialTab);
}

function _closeDrawer() {
  document.body.classList.remove(DRAWER_OPEN_CLASS);
  _clearTabs();
}

export function initMobileDock() {
  const fab = document.getElementById('mobileFab');
  const tabs = document.getElementById('mobileDrawerTabs');
  if (!fab || !tabs) return;

  fab.addEventListener('click', e => {
    e.stopPropagation();
    if (document.body.classList.contains(DRAWER_OPEN_CLASS)) {
      _closeDrawer();
    } else {
      _openDrawer();
    }
  });

  tabs.addEventListener('click', e => {
    const btn = e.target.closest('.mobile-drawer-tab');
    if (!btn) return;
    e.stopPropagation();
    _setActiveTab(btn.dataset.panel);
  });

  // Tap on the canvas dismisses the drawer so the user can return to
  // the scene without hunting for the FAB. The canvas's own click
  // handler still fires for body-pick / aim-spawn — both run.
  canvas.addEventListener('click', () => {
    if (document.body.classList.contains(DRAWER_OPEN_CLASS)) {
      _closeDrawer();
    }
  });

  // Esc closes too (hardware keyboards / kiosk setups).
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' && document.body.classList.contains(DRAWER_OPEN_CLASS)) {
      _closeDrawer();
    }
  });
}
