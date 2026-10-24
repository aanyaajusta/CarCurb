/* common.js — loaded on every page: talks to the API, remembers the login, draws header/footer, small helpers. */
'use strict';

/* ---- login memory (the browser keeps the session token in localStorage) ---- */
const TOKEN_KEY = 'carcurb_token', USER_KEY = 'carcurb_user';
const mem = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
};
const getToken = () => mem.get(TOKEN_KEY);
const getUser = () => { try { return JSON.parse(mem.get(USER_KEY)); } catch (e) { return null; } };
function saveSession(token, user) { mem.set(TOKEN_KEY, token); mem.set(USER_KEY, JSON.stringify(user)); }
function clearSession() { mem.del(TOKEN_KEY); mem.del(USER_KEY); }
const HOME = { customer: 'customer.html', center: 'center.html', driver: 'driver.html', admin: 'admin.html' };
let protectedPage = false;

/* ---- calling the backend ---- */
async function api(path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && token) { // session expired or account suspended
    clearSession();
    if (protectedPage) location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) { const err = new Error((data && data.error) || 'Request failed (' + res.status + ')'); err.status = res.status; throw err; }
  return data;
}
function requireRole(...roles) {
  const u = getUser();
  if (!u || !getToken()) { location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search)); return false; }
  if (!roles.includes(u.role)) { location.replace(HOME[u.role] || 'index.html'); return false; }
  protectedPage = true;
  return true;
}

/* ---- safe output: every piece of user text goes through esc() before it is put into HTML ---- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); };
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const PILL = { Pending: 'warn', Confirmed: 'info', 'Pickup Scheduled': 'info', 'Picked Up': 'info', 'Out for Delivery': 'info', 'Vehicle Received': 'work', 'Inspection Completed': 'work', 'Repair In Progress': 'work', 'Quality Check': 'work', 'Ready for Pickup': 'ready', 'Ready for Drop': 'ready', Delivered: 'ok', Rejected: 'bad', Cancelled: 'bad', approved: 'ok', pending: 'warn', rejected: 'bad', suspended: 'bad', paid: 'ok', unpaid: 'warn', open: 'warn', resolved: 'ok' };
const pill = (label) => `<span class="pill pill-${PILL[label] || 'info'}">${esc(label)}</span>`;
const stars = (r) => `<span class="star-text" role="img" aria-label="${r} out of 5">${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}</span>`;
const $ = (sel, root) => (root || document).querySelector(sel);

function toast(msg, isError) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
// Runs an action, shows errors as a toast, and keeps the button from being double-clicked.
async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}
// Vertical progress list used on the tracking page.
function timeline(flow, status, history) {
  const idx = flow.indexOf(status), when = {};
  (history || []).forEach((h) => { when[h.status] = h.at; });
  return '<ol class="tl">' + flow.map((s, i) => {
    const cls = status === 'Delivered' || i < idx ? 'done' : i === idx ? 'now' : '';
    return `<li class="${cls}"${i === idx ? ' aria-current="step"' : ''}><span class="dot" aria-hidden="true"></span>${esc(s)}${when[s] ? `<span class="tl-time">${fmtWhen(when[s])}</span>` : ''}</li>`;
  }).join('') + '</ol>';
}
function showError(el, msg) { el.innerHTML = `<div class="alert alert-error" role="alert">${esc(msg)}</div>`; }

/* ---- header, notification bell, footer ---- */
function renderChrome() {
  const u = getUser(), page = document.body.dataset.page || '';
  const links = !u ? [['find.html', 'Find a center', 'find'], ['register.html?as=center', 'For service centers', 'register-center']]
    : u.role === 'customer' ? [['find.html', 'Find a center', 'find'], ['customer.html', 'My bookings', 'customer']]
    : u.role === 'center' ? [['center.html', 'Bookings', 'center'], ['center-setup.html', 'Setup', 'center-setup']]
    : u.role === 'driver' ? [['driver.html', 'My jobs', 'driver']] : [['admin.html', 'Admin panel', 'admin']];
  const nav = links.map(([href, label, key]) => `<a href="${href}"${key === page ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const acct = u
    ? `<button class="btn btn-ghost btn-sm bell" id="bell" aria-label="Notifications" aria-expanded="false">🔔<span class="bell-count" id="bellCount" hidden>0</span></button><span class="who">${esc(u.name.split(' ')[0])}</span><button class="btn btn-ghost btn-sm" id="logout">Log out</button>`
    : `<a class="btn btn-ghost btn-sm" href="login.html">Log in</a><a class="btn btn-sm" href="register.html">Sign up</a>`;
  const head = document.getElementById('siteHeader');
  if (head) head.innerHTML = `<header class="site"><div class="wrap bar"><a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true"></span>CarCurb</a><nav class="nav" aria-label="Main">${nav}</nav><div class="acct">${acct}</div></div><div class="kerb"></div></header>`;
  const foot = document.getElementById('siteFooter');
  if (foot) foot.innerHTML = `<footer class="foot"><div class="wrap"><p><a href="find.html">Find a center</a><a href="register.html?as=center">List your service center</a><a href="login.html">Log in</a></p><p>CarCurb connects car owners with service centers. Payments are made directly to the service center, never to CarCurb.</p></div></footer>`;
  if (u) setupBell(u);
}
let bellOpen = false;
async function loadBell() {
  try {
    const n = await api('/notifications');
    const c = $('#bellCount');
    if (c) { c.textContent = n.unread; c.hidden = n.unread === 0; }
    return n;
  } catch (e) { return null; }
}
function setupBell(u) {
  $('#logout').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* already logged out */ } clearSession(); location.href = 'index.html'; });
  $('#bell').addEventListener('click', async () => {
    let panel = $('#notifPanel');
    if (panel) { panel.remove(); $('#bell').setAttribute('aria-expanded', 'false'); return; }
    const n = await loadBell();
    if (!n) return;
    panel = document.createElement('div');
    panel.id = 'notifPanel'; panel.className = 'notif-panel';
    const target = (x) => (u.role === 'customer' && x.bookingId ? 'booking.html?id=' + encodeURIComponent(x.bookingId) : HOME[u.role]);
    panel.innerHTML = `<header><strong>Notifications</strong></header>` + (n.items.length ? n.items.map((x) => `<a class="notif-item${x.read ? '' : ' unread'}" href="${target(x)}">${esc(x.text)}<time>${fmtWhen(x.at)}</time></a>`).join('') : '<p class="muted" style="padding:14px">Nothing yet. Updates about your bookings will show up here.</p>');
    document.body.appendChild(panel);
    $('#bell').setAttribute('aria-expanded', 'true');
    api('/notifications/read', { method: 'POST' }).then(() => { const c = $('#bellCount'); if (c) c.hidden = true; }).catch(() => {});
  });
  loadBell();
  setInterval(loadBell, 30000);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const p = $('#notifPanel'); if (p) p.remove(); } });
renderChrome();
