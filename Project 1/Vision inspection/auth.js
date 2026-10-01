/*
 * Demo sign-in, roles, permissions, and station settings.
 *
 * Roles and function-based permissions follow intent.md. Everything runs in the browser
 * (users, hashed passwords, and settings live in localStorage), so this demonstrates the
 * workflow but is NOT real security: anyone with access to the browser can read or change it.
 */

const AUTH_KEY = 'visionforge.auth.v1';
const SESSION_KEY = 'visionforge.session.v1';

const PERMISSIONS = {
  RunInspection: 'Run inspections, capture frames, pause or resume the line',
  ViewReports: 'View results, traceability, and reports',
  ModifyRecipe: 'Change tools, ROIs, and criteria; submit recipe changes',
  ApproveRecipe: 'Approve or reject recipe changes; save approved versions',
  ConfigureCamera: 'Connect and configure cameras',
  ManageUsers: 'Add users, change roles, reset passwords, deactivate accounts',
  ManageSettings: 'Change station, session, learning, and retention settings',
};

const ROLES = {
  operator: { label: 'Operator', permissions: ['RunInspection', 'ViewReports'] },
  quality: { label: 'Quality engineer', permissions: ['RunInspection', 'ViewReports', 'ModifyRecipe', 'ApproveRecipe'] },
  production: { label: 'Production engineer', permissions: ['RunInspection', 'ViewReports', 'ModifyRecipe', 'ConfigureCamera'] },
  admin: { label: 'Administrator', permissions: Object.keys(PERMISSIONS) },
};

const DEFAULT_SETTINGS = {
  stationName: 'Station 01',
  lineName: 'LINE A · CELL 04',
  sessionTimeoutMin: 30,
  learnSamples: 20,
  retentionPassDays: 7,
  retentionFailDays: 90,
  saveImages: 'all',
};

const SETTING_FIELDS = [
  { key: 'stationName', label: 'Station name', type: 'text' },
  { key: 'lineName', label: 'Line / cell', type: 'text' },
  { key: 'sessionTimeoutMin', label: 'Sign out after inactivity (minutes)', type: 'number', min: 1, max: 480 },
  { key: 'learnSamples', label: 'Good parts used by Learn limits', type: 'number', min: 5, max: 100 },
  { key: 'retentionPassDays', label: 'Keep PASS images (days)', type: 'number', min: 1, max: 3650 },
  { key: 'retentionFailDays', label: 'Keep FAIL / ERROR images (days)', type: 'number', min: 1, max: 3650 },
  { key: 'saveImages', label: 'Save inspection images', type: 'select', options: [['all', 'All inspections'], ['fail', 'FAIL and ERROR only'], ['off', 'Off']] },
];

const DEMO_USERS = [
  { username: 'operator', name: 'Sakthi M.', role: 'operator', password: 'operator123' },
  { username: 'quality', name: 'Priya R.', role: 'quality', password: 'quality123' },
  { username: 'production', name: 'Arun K.', role: 'production', password: 'production123' },
  { username: 'admin', name: 'Admin', role: 'admin', password: 'admin123' },
];

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 30000;

const auth = {
  user: null,
  store: null, // { users: [...], settings: {...} }
  failed: {},
  listeners: [],
  auditSink: null,
  pendingAudit: [],

  can(permission) {
    return Boolean(this.user && ROLES[this.user.role]?.permissions.includes(permission));
  },
  roleLabel(role) {
    return ROLES[role]?.label || role;
  },
  get settings() {
    return { ...DEFAULT_SETTINGS, ...(this.store?.settings || {}) };
  },
  onChange(listener) {
    this.listeners.push(listener);
  },
  notify() {
    applyPermissions();
    this.listeners.forEach((listener) => listener(this.user));
  },
  // inspection.js provides the shared audit trail; entries made before it loads are queued.
  setAuditSink(sink) {
    this.auditSink = sink;
    this.pendingAudit.splice(0).forEach(sink);
  },
  audit(action, object, oldValue, newValue, reason = '—') {
    const entry = {
      time: new Date().toISOString(),
      user: this.user ? `${this.user.name} (${this.roleLabel(this.user.role)})` : 'System',
      action, object, oldValue: String(oldValue), newValue: String(newValue), reason,
    };
    if (this.auditSink) this.auditSink(entry); else this.pendingAudit.push(entry);
  },
};

/* ---------- Storage and password hashing ---------- */

function saveAuthStore() {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth.store)); } catch { /* session only */ }
}

async function hashPassword(password, salt) {
  const text = `${salt}:${password}`;
  if (window.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback when Web Crypto is unavailable (e.g. opened as a file): FNV-1a, demo only.
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `fnv${(h >>> 0).toString(16)}`;
}

const newSalt = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

async function makeUser({ username, name, role, password }) {
  const salt = newSalt();
  return { id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, username, name, role, active: true, salt, hash: await hashPassword(password, salt) };
}

async function loadAuthStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (stored?.users?.length) { auth.store = stored; return; }
  } catch { /* seed below */ }
  auth.store = { users: await Promise.all(DEMO_USERS.map(makeUser)), settings: { ...DEFAULT_SETTINGS } };
  saveAuthStore();
}

/* ---------- Sessions ---------- */

function saveSession() {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: auth.user.id, lastActive: Date.now() })); } catch { /* session only */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

function restoreSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    const user = auth.store.users.find((u) => u.id === session?.userId && u.active);
    if (user && Date.now() - session.lastActive < auth.settings.sessionTimeoutMin * 60000) {
      auth.user = user;
      saveSession();
      return true;
    }
  } catch { /* sign in again */ }
  clearSession();
  return false;
}

let lastActivitySaved = 0;
['pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, () => {
  if (auth.user && Date.now() - lastActivitySaved > 15000) { lastActivitySaved = Date.now(); saveSession(); }
}, { passive: true }));

window.setInterval(() => {
  if (!auth.user) return;
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    const idle = Date.now() - (session?.lastActive || 0);
    if (idle >= auth.settings.sessionTimeoutMin * 60000) logout(`Signed out after ${auth.settings.sessionTimeoutMin} minutes of inactivity.`);
  } catch { /* ignore */ }
}, 20000);

async function login(username, password) {
  const key = username.trim().toLowerCase();
  const lock = auth.failed[key];
  if (lock?.until > Date.now()) throw new Error(`Too many failed attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 1000)} s.`);
  const user = auth.store.users.find((u) => u.username.toLowerCase() === key);
  const ok = user && user.active && (await hashPassword(password, user.salt)) === user.hash;
  if (!ok) {
    const count = (lock?.count || 0) + 1;
    auth.failed[key] = { count, until: count >= MAX_FAILED_LOGINS ? Date.now() + LOCKOUT_MS : 0 };
    if (user && !user.active) throw new Error('This account is deactivated. Contact an administrator.');
    throw new Error(count >= MAX_FAILED_LOGINS ? 'Too many failed attempts. Sign-in locked for 30 s.' : 'Incorrect username or password.');
  }
  delete auth.failed[key];
  auth.user = user;
  saveSession();
  auth.audit('Login', 'Session', '—', 'signed in');
  auth.notify();
}

function logout(message = 'Signed out.') {
  if (!auth.user) return;
  auth.audit('Logout', 'Session', 'signed in', message.startsWith('Signed out after') ? 'timed out' : 'signed out');
  auth.user = null;
  clearSession();
  auth.notify();
  showToast(message);
}

/* ---------- Applying permissions to the page ---------- */

const authEls = {
  login: document.querySelector('#loginScreen'),
  loginForm: document.querySelector('#loginForm'),
  loginUser: document.querySelector('#loginUser'),
  loginPassword: document.querySelector('#loginPassword'),
  loginError: document.querySelector('#loginError'),
  loginStation: document.querySelector('#loginStation'),
  demoAccounts: document.querySelector('#demoAccounts'),
  settingsBody: document.querySelector('#settingsBody'),
  settingsTabs: document.querySelector('#settingsTabs'),
};

function applyPermissions() {
  const user = auth.user;
  authEls.login.hidden = Boolean(user);
  document.body.classList.toggle('signed-out', !user);
  const settings = auth.settings;
  document.querySelector('#stationName').textContent = settings.stationName;
  document.querySelector('#lineName').textContent = settings.lineName;
  authEls.loginStation.textContent = settings.stationName;
  if (user) {
    document.querySelector('#userName').textContent = user.name;
    document.querySelector('#userRole').textContent = auth.roleLabel(user.role);
  }
  document.querySelectorAll('[data-permission]').forEach((element) => {
    const allowed = auth.can(element.dataset.permission);
    if (element.closest('#settingsTabs')) { element.hidden = !allowed; return; }
    element.disabled = !allowed;
    element.title = allowed ? (element.dataset.title || element.title || '') : `Requires the ${element.dataset.permission} permission`;
  });
}

/* ---------- Login screen ---------- */

authEls.demoAccounts.innerHTML = DEMO_USERS.map((u) => `<button type="button" data-demo="${u.username}"><strong>${u.name}</strong><small>${ROLES[u.role].label} · ${u.username} / ${u.password}</small></button>`).join('');
authEls.demoAccounts.addEventListener('click', (event) => {
  const button = event.target.closest('[data-demo]');
  if (!button) return;
  const demo = DEMO_USERS.find((u) => u.username === button.dataset.demo);
  authEls.loginUser.value = demo.username;
  authEls.loginPassword.value = demo.password;
  authEls.loginPassword.focus();
});

authEls.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authEls.loginError.hidden = true;
  try {
    await login(authEls.loginUser.value, authEls.loginPassword.value);
    authEls.loginPassword.value = '';
    showToast(`Signed in as ${auth.user.name} · ${auth.roleLabel(auth.user.role)}.`);
  } catch (error) {
    authEls.loginError.textContent = error.message;
    authEls.loginError.hidden = false;
    authEls.loginPassword.select();
  }
});

/* ---------- Top bar ---------- */

document.querySelector('#logoutButton').addEventListener('click', () => logout());

/* ---------- Modals ---------- */

function openModal(modal) { modal.hidden = false; }
function closeModal(modal) { if (modal) modal.hidden = true; }
document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-modal]');
  if (close) closeModal(close.closest('.modal'));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach(closeModal);
});

/* ---------- Settings view ---------- */

let settingsTab = 'account';
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function openSettings(tab = 'account') {
  settingsTab = tab;
  showView('settings');
}

function renderSettings() {
  if (!auth.user) return;
  const tabs = [...authEls.settingsTabs.querySelectorAll('[data-tab]')];
  if (!tabs.some((t) => t.dataset.tab === settingsTab && !t.hidden)) settingsTab = 'account';
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === settingsTab));
  authEls.settingsBody.innerHTML = { account: accountTab, users: usersTab, roles: rolesTab, station: stationTab }[settingsTab]();
}

function accountTab() {
  const u = auth.user;
  return `<div class="settings-section">
    <dl class="account-facts"><div><dt>NAME</dt><dd>${esc(u.name)}</dd></div><div><dt>USERNAME</dt><dd>${esc(u.username)}</dd></div><div><dt>ROLE</dt><dd>${esc(auth.roleLabel(u.role))}</dd></div></dl>
    <h3>Your permissions</h3>
    <ul class="perm-list">${ROLES[u.role].permissions.map((p) => `<li><b>${p}</b> ${esc(PERMISSIONS[p])}</li>`).join('')}</ul>
    <h3>Change password</h3>
    <form class="settings-form" data-form="password">
      <label>Current password<input type="password" name="current" required autocomplete="current-password" /></label>
      <label>New password<input type="password" name="next" required minlength="6" autocomplete="new-password" /></label>
      <label>Repeat new password<input type="password" name="repeat" required minlength="6" autocomplete="new-password" /></label>
      <button class="primary-button" type="submit">Change password</button>
    </form>
  </div>`;
}

function usersTab() {
  const roleOptions = (selected) => Object.entries(ROLES).map(([key, r]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${r.label}</option>`).join('');
  return `<div class="settings-section">
    <table class="users-table">
      <thead><tr><th>NAME</th><th>USERNAME</th><th>ROLE</th><th>STATUS</th><th></th></tr></thead>
      <tbody>${auth.store.users.map((u) => `<tr class="${u.active ? '' : 'inactive'}">
        <td>${esc(u.name)}${u.id === auth.user.id ? ' <small>(you)</small>' : ''}</td>
        <td>${esc(u.username)}</td>
        <td><select data-user-role="${u.id}" ${u.id === auth.user.id ? 'disabled title="You cannot change your own role"' : ''}>${roleOptions(u.role)}</select></td>
        <td><button type="button" class="text-button" data-user-toggle="${u.id}" ${u.id === auth.user.id ? 'disabled' : ''}>${u.active ? 'Active' : 'Deactivated'}</button></td>
        <td><button type="button" class="text-button" data-user-reset="${u.id}">Reset password</button></td>
      </tr>`).join('')}</tbody>
    </table>
    <h3>Add user</h3>
    <form class="settings-form inline" data-form="add-user">
      <label>Full name<input name="name" required maxlength="40" /></label>
      <label>Username<input name="username" required maxlength="24" pattern="[A-Za-z0-9._-]+" /></label>
      <label>Role<select name="role">${roleOptions('operator')}</select></label>
      <label>Temporary password<input name="password" type="text" required minlength="6" /></label>
      <button class="primary-button" type="submit">Add user</button>
    </form>
  </div>`;
}

function rolesTab() {
  const roles = Object.entries(ROLES);
  return `<div class="settings-section">
    <p class="settings-hint">Permissions are defined by function (intent.md). A recipe change by a role without <b>ApproveRecipe</b> is submitted for approval; the approver must be a different person.</p>
    <table class="perm-matrix">
      <thead><tr><th>PERMISSION</th>${roles.map(([, r]) => `<th>${r.label.toUpperCase()}</th>`).join('')}</tr></thead>
      <tbody>${Object.entries(PERMISSIONS).map(([p, text]) => `<tr><td><b>${p}</b><small>${esc(text)}</small></td>${roles.map(([, r]) => `<td>${r.permissions.includes(p) ? '✓' : ''}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function stationTab() {
  const s = auth.settings;
  return `<div class="settings-section">
    <form class="settings-form grid" data-form="settings">
      ${SETTING_FIELDS.map((f) => (f.type === 'select'
        ? `<label>${f.label}<select name="${f.key}">${f.options.map(([v, l]) => `<option value="${v}" ${String(s[f.key]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
        : `<label>${f.label}<input name="${f.key}" type="${f.type}" value="${esc(s[f.key])}" ${f.type === 'number' ? `min="${f.min}" max="${f.max}" step="1"` : 'maxlength="40"'} required /></label>`)).join('')}
      <label class="wide">Reason for change<input name="reason" required placeholder="Required for the audit trail" /></label>
      <button class="primary-button" type="submit">Save settings</button>
    </form>
    <p class="settings-hint">Image retention is stored as configuration for the production image store; this browser prototype does not keep images.</p>
  </div>`;
}

authEls.settingsTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) { settingsTab = tab.dataset.tab; renderSettings(); }
});

const activeAdmins = (users) => users.filter((u) => u.active && u.role === 'admin').length;

authEls.settingsBody.addEventListener('change', (event) => {
  const select = event.target.closest('[data-user-role]');
  if (!select || !auth.can('ManageUsers')) return;
  const user = auth.store.users.find((u) => u.id === select.dataset.userRole);
  const next = auth.store.users.map((u) => (u === user ? { ...u, role: select.value } : u));
  if (!activeAdmins(next)) { showToast('At least one active administrator is required.', 'error'); renderSettings(); return; }
  const old = user.role;
  user.role = select.value;
  saveAuthStore();
  auth.audit('ManageUsers', `User ${user.username}`, auth.roleLabel(old), auth.roleLabel(user.role), 'Role changed');
  showToast(`${user.name} is now ${auth.roleLabel(user.role)}.`);
});

authEls.settingsBody.addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-user-toggle]');
  const reset = event.target.closest('[data-user-reset]');
  if ((!toggle && !reset) || !auth.can('ManageUsers')) return;
  const user = auth.store.users.find((u) => u.id === (toggle || reset).dataset[toggle ? 'userToggle' : 'userReset']);
  if (toggle) {
    const next = auth.store.users.map((u) => (u === user ? { ...u, active: !u.active } : u));
    if (!activeAdmins(next)) { showToast('At least one active administrator is required.', 'error'); return; }
    user.active = !user.active;
    saveAuthStore();
    auth.audit('ManageUsers', `User ${user.username}`, user.active ? 'deactivated' : 'active', user.active ? 'active' : 'deactivated', 'Account status changed');
    renderSettings();
    showToast(`${user.name} ${user.active ? 'reactivated' : 'deactivated'}.`);
  }
  if (reset) {
    const temporary = `temp${Math.random().toString(36).slice(2, 8)}`;
    user.salt = newSalt();
    user.hash = await hashPassword(temporary, user.salt);
    saveAuthStore();
    auth.audit('ManageUsers', `User ${user.username}`, 'password', 'reset', 'Password reset by administrator');
    showToast(`Temporary password for ${user.username}: ${temporary}`);
  }
});

authEls.settingsBody.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.form === 'password') {
      if ((await hashPassword(data.current, auth.user.salt)) !== auth.user.hash) throw new Error('Current password is incorrect.');
      if (data.next !== data.repeat) throw new Error('The new passwords do not match.');
      if (data.next.length < 6) throw new Error('Use at least 6 characters.');
      auth.user.salt = newSalt();
      auth.user.hash = await hashPassword(data.next, auth.user.salt);
      saveAuthStore();
      auth.audit('ChangePassword', `User ${auth.user.username}`, 'password', 'changed', 'Changed by user');
      form.reset();
      showToast('Password changed.');
    }
    if (form.dataset.form === 'add-user') {
      if (!auth.can('ManageUsers')) throw new Error('Requires the ManageUsers permission.');
      if (auth.store.users.some((u) => u.username.toLowerCase() === data.username.toLowerCase())) throw new Error(`Username “${data.username}” already exists.`);
      const user = await makeUser(data);
      auth.store.users.push(user);
      saveAuthStore();
      auth.audit('ManageUsers', `User ${user.username}`, '—', `${user.name} · ${auth.roleLabel(user.role)}`, 'User added');
      renderSettings();
      showToast(`${user.name} added. Share the temporary password with them.`);
    }
    if (form.dataset.form === 'settings') {
      if (!auth.can('ManageSettings')) throw new Error('Requires the ManageSettings permission.');
      const before = auth.settings;
      const next = { ...before };
      SETTING_FIELDS.forEach((f) => { next[f.key] = f.type === 'number' ? Math.min(f.max, Math.max(f.min, Number(data[f.key]))) : f.type === 'select' ? data[f.key] : data[f.key].trim(); });
      const changed = SETTING_FIELDS.filter((f) => String(before[f.key]) !== String(next[f.key]));
      if (!changed.length) { showToast('No settings changed.'); return; }
      auth.store.settings = next;
      saveAuthStore();
      changed.forEach((f) => auth.audit('ManageSettings', f.label, before[f.key], next[f.key], data.reason.trim()));
      applyPermissions();
      if (typeof pushRetention === 'function') pushRetention().catch((error) => showToast(`Retention not applied on the station: ${error.message}`, 'error'));
      renderSettings();
      showToast(`${changed.length} setting${changed.length === 1 ? '' : 's'} saved.`);
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
});

/* ---------- Start-up ---------- */

auth.ready = loadAuthStore().then(() => {
  restoreSession();
  auth.notify();
  if (!auth.user) authEls.loginUser.focus();
});
