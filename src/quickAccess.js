import { Capacitor, registerPlugin } from '@capacitor/core';
import './quickAccess.css';

const NativeLauncher = registerPlugin('FloatingLauncher');
const enabledKey = 'famguard-floating-launcher-enabled';
const modeKey = 'famguard-floating-launcher-mode';
const featureActions = [
  ['Home', '⌂', 'home'],
  ['Locations', '⌖', 'location'],
  ['Calendar', '▦', 'calendar'],
  ['Fam-Dash', '♡', 'famdash'],
  ['Community', '☏', 'community'],
  ['Settings', '⚙', 'settings'],
  ['SOS', '!', 'sos'],
  ['Add event', '+', 'add-event'],
  ['Tasks', '✓', 'tasks']
];

function safeGet(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    window.toast('The floating launcher setting could not be saved on this device.');
  }
}

function createHomeCalendarDrawer() {
  const home = document.getElementById('view-home');
  const homeHeading = home?.querySelector('.page-heading');
  const calendar = document.getElementById('view-calendar');
  const topbar = document.querySelector('.topbar');
  const topActions = document.querySelector('.top-actions');
  if (!home || !homeHeading || !calendar || !topbar || !topActions) return;

  document.querySelector('.mobile-nav [data-view="calendar"]')?.remove();

  const homeHandle = document.createElement('button');
  homeHandle.className = 'home-calendar-handle';
  homeHandle.type = 'button';
  homeHandle.setAttribute('aria-label', 'Open family calendar');
  homeHandle.innerHTML = '<span class="home-calendar-grip" aria-hidden="true"></span><span>Pull down for family calendar</span><span aria-hidden="true">⌄</span>';
  home.insertBefore(homeHandle, homeHeading);

  const topButton = document.createElement('button');
  topButton.className = 'icon-button home-calendar-top-button';
  topButton.type = 'button';
  topButton.setAttribute('aria-label', 'Open family calendar');
  topButton.setAttribute('aria-expanded', 'false');
  topButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';
  topActions.prepend(topButton);

  const backdrop = document.createElement('button');
  backdrop.className = 'calendar-overlay-backdrop';
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Close family calendar');
  backdrop.hidden = true;
  document.body.append(backdrop);

  const controls = document.createElement('div');
  controls.className = 'calendar-overlay-controls';
  controls.innerHTML = `
    <button class="calendar-overlay-grab" type="button" aria-label="Close calendar by pulling up">
      <span class="home-calendar-grip" aria-hidden="true"></span>
    </button>
    <button class="icon-button calendar-overlay-close" type="button" aria-label="Close family calendar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>
    </button>`;
  calendar.prepend(controls);

  const closeButton = controls.querySelector('.calendar-overlay-close');
  const pullHandle = controls.querySelector('.calendar-overlay-grab');
  const mobileNav = document.querySelector('.mobile-nav');
  let previouslyFocused = null;
  let calendarWasActive = false;
  let closeTimer = null;
  let pull = null;

  function setOverlayOpen(open) {
    if (open) {
      if (calendar.classList.contains('calendar-overlay-open')) return;
      window.clearTimeout(closeTimer);
      calendarWasActive = calendar.classList.contains('active');
      previouslyFocused = document.activeElement;
      backdrop.hidden = false;
      backdrop.classList.add('is-visible');
      calendar.classList.add('calendar-overlay-open', 'active');
      calendar.classList.remove('calendar-overlay-closing');
      calendar.inert = false;
      calendar.setAttribute('role', 'dialog');
      calendar.setAttribute('aria-modal', 'true');
      calendar.setAttribute('aria-label', 'Family calendar');
      calendar.setAttribute('aria-hidden', 'false');
      topButton.setAttribute('aria-expanded', 'true');
      home.inert = true;
      topbar.inert = true;
      if (mobileNav) mobileNav.inert = true;
      closeButton.focus();
      return;
    }

    if (!calendar.classList.contains('calendar-overlay-open')) return;
    calendar.classList.remove('calendar-overlay-open');
    calendar.classList.add('calendar-overlay-closing');
    backdrop.classList.remove('is-visible');
    calendar.inert = true;
    calendar.removeAttribute('role');
    calendar.removeAttribute('aria-modal');
    calendar.removeAttribute('aria-label');
    calendar.removeAttribute('aria-hidden');
    topButton.setAttribute('aria-expanded', 'false');
    home.inert = false;
    topbar.inert = false;
    if (mobileNav) mobileNav.inert = false;
    previouslyFocused?.focus();
    previouslyFocused = null;
    closeTimer = window.setTimeout(() => {
      calendar.classList.remove('calendar-overlay-closing');
      if (!calendarWasActive) calendar.classList.remove('active');
      calendar.inert = false;
      backdrop.hidden = true;
    }, 320);
  }

  function beginPull(element, direction, ignoreButtons) {
    element.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || (ignoreButtons && event.target.closest('button'))) return;
      pull = { pointerId: event.pointerId, startY: event.clientY, direction };
    });
  }

  document.addEventListener('pointerup', event => {
    if (!pull || pull.pointerId !== event.pointerId) return;
    const distance = event.clientY - pull.startY;
    const { direction } = pull;
    pull = null;
    if (Math.abs(distance) < 48) return;
    if ((direction === 'down' && distance > 0) || (direction === 'up' && distance < 0)) {
      setOverlayOpen(direction === 'down');
    }
  });
  document.addEventListener('pointercancel', () => { pull = null; });
  beginPull(topbar, 'down', true);
  beginPull(homeHandle, 'down', false);
  beginPull(pullHandle, 'up', false);

  homeHandle.addEventListener('click', () => setOverlayOpen(true));
  topButton.addEventListener('click', () => setOverlayOpen(!calendar.classList.contains('calendar-overlay-open')));
  closeButton.addEventListener('click', () => setOverlayOpen(false));
  backdrop.addEventListener('click', () => setOverlayOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && calendar.classList.contains('calendar-overlay-open')) {
      setOverlayOpen(false);
    }
  });
}

function createLauncherSettings() {
  const grid = document.querySelector('#view-settings .settings-grid');
  if (!grid) return;
  const card = document.createElement('section');
  card.className = 'card settings-card';
  card.innerHTML = `
    <h2>Floating quick launcher</h2>
    <p>Show FamGuard shortcuts over this app. On Android, enable Display over other apps to keep the launcher above other apps; browsers show it inside FamGuard.</p>
    <div class="toggle-row"><span id="floating-launcher-status">Launcher is off</span><label class="switch"><input id="floating-launcher-toggle" type="checkbox" aria-label="Enable the floating FamGuard launcher"><span></span></label></div>
    <label class="eyebrow floating-launcher-mode" for="floating-launcher-mode">Launcher style<select class="select" id="floating-launcher-mode"><option value="drawer">Snap-to-edge bubble and drawer</option><option value="grid">3 × 3 quick-action grid</option></select></label>`;
  grid.append(card);
}

function createFloatingLauncher() {
  const root = document.createElement('div');
  root.className = 'floating-launcher';
  root.hidden = true;
  root.innerHTML = `
    <div class="floating-launcher-panel" hidden></div>
    <button class="floating-launcher-trigger" type="button" aria-label="Open FamGuard quick launcher" aria-expanded="false">FG</button>`;
  document.body.append(root);
  const panel = root.querySelector('.floating-launcher-panel');
  const trigger = root.querySelector('.floating-launcher-trigger');
  const toggle = document.getElementById('floating-launcher-toggle');
  const modeSelect = document.getElementById('floating-launcher-mode');
  const status = document.getElementById('floating-launcher-status');
  let mode = safeGet(modeKey, 'drawer');

  function renderPanel() {
    panel.dataset.mode = mode;
    panel.replaceChildren();
    featureActions.forEach(([label, icon, feature]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'floating-launcher-action';
      const symbol = document.createElement('span');
      symbol.textContent = icon;
      const text = document.createElement('span');
      text.textContent = label;
      button.append(symbol, text);
      button.addEventListener('click', () => openFeature(feature));
      panel.append(button);
    });
  }

  function setOpen(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  }

  modeSelect.value = mode;
  toggle.checked = safeGet(enabledKey, 'false') === 'true';
  root.hidden = !toggle.checked || Capacitor.isNativePlatform();
  status.textContent = toggle.checked ? 'Launcher is on' : 'Launcher is off';
  renderPanel();
  let dragged = false;
  trigger.addEventListener('click', () => {
    if (!dragged) setOpen(panel.hidden);
    dragged = false;
  });

  toggle.addEventListener('change', async () => {
    const requested = toggle.checked;
    if (Capacitor.isNativePlatform()) {
      try {
        if (requested) {
          let permission = await NativeLauncher.checkPermission();
          if (!permission.granted) permission = await NativeLauncher.requestPermission();
          if (!permission.granted) throw new Error('Allow Display over other apps in Android settings, then enable the launcher again.');
        }
        await NativeLauncher.setMode({ mode });
        await NativeLauncher.setEnabled({ enabled: requested });
      } catch (error) {
        toggle.checked = false;
        root.hidden = true;
        status.textContent = 'Launcher is off';
        window.toast(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    safeSet(enabledKey, String(requested));
    root.hidden = !requested || Capacitor.isNativePlatform();
    setOpen(false);
    status.textContent = requested
      ? Capacitor.isNativePlatform() ? 'Android overlay launcher is on' : 'In-app launcher is on'
      : 'Launcher is off';
  });

  modeSelect.addEventListener('change', async () => {
    mode = modeSelect.value === 'grid' ? 'grid' : 'drawer';
    safeSet(modeKey, mode);
    renderPanel();
    setOpen(false);
    if (Capacitor.isNativePlatform() && toggle.checked) {
      try {
        await NativeLauncher.setMode({ mode });
      } catch (error) {
        window.toast(`The Android launcher mode could not be changed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  let dragStart = null;
  trigger.addEventListener('pointerdown', event => {
    dragStart = { x: event.clientX, y: event.clientY, left: root.offsetLeft, top: root.offsetTop };
    trigger.setPointerCapture(event.pointerId);
  });
  trigger.addEventListener('pointermove', event => {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) < 8) return;
    dragged = true;
    root.style.left = `${Math.max(0, Math.min(window.innerWidth - 54, dragStart.left + dx))}px`;
    root.style.top = `${Math.max(8, Math.min(window.innerHeight - 62, dragStart.top + dy))}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  });
  trigger.addEventListener('pointerup', () => {
    if (!dragStart) return;
    if (root.style.left) {
      const nearLeft = root.offsetLeft < window.innerWidth / 2;
      root.style.left = nearLeft ? '0px' : 'auto';
      root.style.right = nearLeft ? 'auto' : '0px';
    }
    dragStart = null;
    window.setTimeout(() => { dragged = false; }, 0);
  });

  window.addEventListener('focus', async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const result = await NativeLauncher.getPendingFeature();
      if (result.feature) openFeature(result.feature);
    } catch (error) {
      window.toast(`The Android launcher action could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (Capacitor.isNativePlatform()) {
    NativeLauncher.getPendingFeature().then(result => {
      if (result.feature) openFeature(result.feature);
    }).catch(error => {
      window.toast(`The Android launcher action could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

function openFeature(feature) {
  const view = feature === 'tasks' ? 'settings' : feature === 'add-event' ? 'calendar' : feature;
  if (['home', 'location', 'calendar', 'famdash', 'community', 'settings'].includes(view)) {
    document.querySelector(`[data-view="${view}"]`)?.click();
  }
  if (feature === 'sos') document.getElementById('sos-button')?.click();
  if (feature === 'add-event') setTimeout(() => document.getElementById('add-event')?.click(), 0);
  if (feature === 'tasks') setTimeout(() => document.getElementById('task-form')?.scrollIntoView({ behavior: 'smooth' }), 0);
  document.querySelector('.floating-launcher-trigger')?.setAttribute('aria-expanded', 'false');
  document.querySelector('.floating-launcher-panel')?.setAttribute('hidden', '');
}

createHomeCalendarDrawer();
createLauncherSettings();
createFloatingLauncher();
