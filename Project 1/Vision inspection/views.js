/*
 * Shell navigation and theme, following the Expense360 console layout: a left sidebar of
 * icon tabs that show one view at a time (filtered by the signed-in role's permissions),
 * and a Light / Dark / Auto theme switch in the top bar.
 */

const VIEW_KEY = 'visionforge.view';
const THEME_KEY = 'visionforge.theme';
const SIDEBAR_KEY = 'visionforge.sidebar';

const svg = (body) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${body}</svg>`;
const TABS = [
  { id: 'overview', label: 'Overview', icon: svg('<rect x="1.5" y="8.5" width="3" height="6"/><rect x="6.5" y="4.5" width="3" height="10"/><rect x="11.5" y="1.5" width="3" height="13"/>') },
  { id: 'live', label: 'Live inspection', permission: 'RunInspection', icon: svg('<rect x="1.5" y="3.5" width="13" height="9.5" rx="1.5"/><circle cx="8" cy="8.2" r="2.6"/><path d="M5 3.5l1-1.7h4l1 1.7"/>') },
  { id: 'program', label: 'Inspection program', icon: svg('<path d="M2 3h7M2 8h4M2 13h7"/><circle cx="11.5" cy="3" r="1.5"/><circle cx="8.5" cy="8" r="1.5"/><circle cx="11.5" cy="13" r="1.5"/><path d="M13 3h1M10 8h4M13 13h1"/>') },
  { id: 'audit', label: 'Audit log', permission: 'ViewReports', icon: svg('<path d="M4 1.8h6.2L13 4.6v9.6H4Z"/><path d="M6 7.4h5M6 10h5"/>') },
  { id: 'settings', label: 'Settings', icon: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3"/>') },
];

const nav = document.querySelector('#sideNav');
let currentView = 'overview';

const visibleTabs = () => TABS.filter((tab) => !tab.permission || auth.can(tab.permission));

function renderNav() {
  // title gives the name on hover when the menu is collapsed to icons; the label stays for screen readers.
  nav.innerHTML = visibleTabs().map((tab) => `<button type="button" class="tab-btn${tab.id === currentView ? ' active' : ''}" data-tab="${tab.id}" title="${tab.label}"${tab.id === currentView ? ' aria-current="page"' : ''}><span class="tab-icon">${tab.icon}</span><span class="tab-label">${tab.label}</span></button>`).join('');
}

function showView(id, { scroll = true } = {}) {
  const tabs = visibleTabs();
  if (!tabs.some((tab) => tab.id === id)) id = tabs[0]?.id || 'overview';
  currentView = id;
  document.querySelectorAll('#main > .view').forEach((view) => { view.hidden = view.id !== `view-${id}`; });
  renderNav();
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  try { localStorage.setItem(VIEW_KEY, id); } catch { /* session only */ }
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'settings' && typeof renderSettings === 'function') renderSettings();
}

nav.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) showView(tab.dataset.tab);
});
window.addEventListener('hashchange', () => showView(location.hash.slice(1), { scroll: false }));

// Show the requested view (link #hash, else the last one used) whenever the user changes.
function syncViewToUser() {
  let initial = location.hash.slice(1);
  if (!TABS.some((tab) => tab.id === initial)) {
    try { initial = localStorage.getItem(VIEW_KEY) || 'overview'; } catch { initial = 'overview'; }
  }
  showView(auth.user ? initial : currentView, { scroll: false });
}
auth.onChange(syncViewToUser);
// A saved session can be restored before this script runs, so also sync once now.
if (auth.user) syncViewToUser();

/* ---------- Theme: Light / Dark / Auto (follows the system) ---------- */

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
  else document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('.theme-btn').forEach((button) => button.classList.toggle('active', button.dataset.themeChoice === choice));
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* session only */ }
}
document.querySelectorAll('.theme-btn').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
(() => {
  let saved = 'system';
  try { saved = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* default */ }
  applyTheme(saved);
})();

/* ---------- Collapsible side menu (icons only) ---------- */

const sidebarToggle = document.querySelector('#sidebarToggle');
function setSidebarCollapsed(collapsed) {
  document.querySelector('#appShell').classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.querySelector('.tab-label').textContent = collapsed ? 'Show menu' : 'Hide menu';
  sidebarToggle.title = collapsed ? 'Show menu' : 'Hide menu';
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* session only */ }
}
sidebarToggle.addEventListener('click', () => setSidebarCollapsed(!document.querySelector('#appShell').classList.contains('sidebar-collapsed')));
try { setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === 'collapsed'); } catch { setSidebarCollapsed(false); }

renderNav();
