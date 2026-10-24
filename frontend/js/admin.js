/* admin.js — platform oversight: approvals, users, complaints, bookings, reports. */
'use strict';
(async () => {
  if (!requireRole('admin')) return;
  const view = $('#view');
  const TABS = { overview: 'Overview', centers: 'Service centers', users: 'Users', complaints: 'Complaints', bookings: 'Bookings' };
  let tab = 'overview';

  const table = (head, rows) => `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">Nothing here yet.</td></tr>`}</tbody></table></div>`;

  const SCREENS = {
    async overview() {
      const s = await api('/admin/stats');
      const list = (o) => Object.entries(o).map(([k, n]) => `<tr><td>${esc(k)}</td><td style="text-align:right"><strong>${n}</strong></td></tr>`).join('') || '<tr><td class="muted">None</td></tr>';
      return `<div class="grid g4 keep2"><div class="stat"><b>${s.totalBookings}</b><span>Total bookings</span></div><div class="stat"><b>${s.paidBookings}</b><span>Paid bookings</span></div><div class="stat"><b>${money(s.recordedRevenue)}</b><span>Payments recorded by centers</span></div><div class="stat"><b>${s.openComplaints}</b><span>Open complaints</span></div></div>
        <div class="grid g3" style="margin-top:14px"><div class="card"><h3>Users</h3><table><tbody>${list(s.users)}</tbody></table></div><div class="card"><h3>Centers</h3><table><tbody>${list(s.centers)}</tbody></table></div><div class="card"><h3>Bookings by status</h3><table><tbody>${list(s.bookings)}</tbody></table></div></div>
        <p style="margin-top:18px"><button class="btn btn-ghost" data-act="csv">Download bookings report (CSV)</button></p>`;
    },
    async centers() {
      const rows = (await api('/admin/centers')).map((c) => `<tr><td><strong>${esc(c.name)}</strong><br><span class="muted small">${esc(c.address)}</span></td><td>${esc(c.owner.name)}<br><span class="muted small">${esc(c.owner.email)}</span></td><td>${c.services} service${c.services === 1 ? '' : 's'}${c.reviewCount ? `<br>${c.rating} ★ (${c.reviewCount})` : ''}</td><td>${pill(c.status)}</td><td><div class="row">${['approved', 'rejected', 'suspended'].filter((x) => x !== c.status).map((x) => `<button class="btn btn-sm ${x === 'approved' ? '' : 'btn-ghost'}" data-act="center-status" data-id="${esc(c.id)}" data-status="${x}">${{ approved: 'Approve', rejected: 'Reject', suspended: 'Suspend' }[x]}</button>`).join('')}</div></td></tr>`);
      return table(['Center', 'Owner', 'Details', 'Status', 'Actions'], rows);
    },
    async users() {
      const rows = (await api('/admin/users')).map((u) => `<tr><td><strong>${esc(u.name)}</strong><br><span class="muted small">${esc(u.email || u.phone)}</span></td><td>${esc(u.role)}${u.center ? `<br><span class="muted small">${esc(u.center)}</span>` : ''}</td><td>${u.active ? pill('approved').replace('approved', 'active') : pill('suspended')}</td><td>${u.role === 'admin' ? '' : `<button class="btn btn-sm btn-ghost" data-act="user-active" data-id="${esc(u.id)}" data-active="${!u.active}">${u.active ? 'Suspend' : 'Reactivate'}</button>`}</td></tr>`);
      return table(['User', 'Role', 'Status', ''], rows);
    },
    async complaints() {
      const all = await api('/admin/complaints');
      return all.length ? all.map((k) => `<article class="card"><div class="row between"><strong>${esc(k.center || '')} · ${esc(k.vehicle || '')}</strong>${pill(k.status)}</div><p class="small muted" style="margin:4px 0">${esc(k.customerName || '')} · ${fmtWhen(k.createdAt)} · booking ${esc(k.bookingId)}</p><p style="margin:6px 0">${esc(k.text)}</p>${k.status === 'resolved' ? `<p class="small"><em>Resolution: ${esc(k.note)}</em></p>` : `<div class="row"><input id="note-${esc(k.id)}" placeholder="Resolution note" maxlength="300" style="flex:1;min-width:200px" aria-label="Resolution note"><button class="btn btn-sm" data-act="resolve" data-id="${esc(k.id)}">Resolve</button></div>`}</article>`).join('') : '<div class="empty">No complaints.</div>';
    },
    async bookings() {
      const rows = (await api('/admin/bookings')).map((b) => `<tr><td>${esc(b.center || '')}</td><td>${esc(b.customerName)}<br><span class="muted small">${esc(b.vehicle)}</span></td><td>${esc(b.serviceName)}<br><span class="muted small">${fmtDate(b.date)}, ${fmtTime(b.time)}${b.pickup ? ' · pickup' : ''}</span></td><td>${pill(b.status)}</td><td>${b.total != null ? money(b.total) : '–'}<br>${pill(b.payment)}</td></tr>`);
      return table(['Center', 'Customer', 'Service', 'Status', 'Bill'], rows);
    },
  };

  async function show() {
    $('#tabs').innerHTML = Object.entries(TABS).map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('');
    view.innerHTML = '<p class="muted">Loading…</p>';
    try { view.innerHTML = await SCREENS[tab](); } catch (e) { showError(view, e.message); }
  }
  async function downloadCsv() {
    const res = await fetch('/api/admin/report.csv', { headers: { Authorization: 'Bearer ' + getToken() } });
    if (!res.ok) throw new Error('Could not download the report');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = 'carcurb-bookings.csv'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; show(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const d = btn.dataset;
    let call;
    if (d.act === 'csv') call = downloadCsv;
    else if (d.act === 'center-status') call = () => api(`/admin/centers/${encodeURIComponent(d.id)}/status`, { method: 'POST', body: { status: d.status } });
    else if (d.act === 'user-active') { if (d.active === 'false' && !confirm('Suspend this account? They will be logged out immediately.')) return; call = () => api(`/admin/users/${encodeURIComponent(d.id)}/active`, { method: 'POST', body: { active: d.active === 'true' } }); }
    else if (d.act === 'resolve') call = () => api(`/admin/complaints/${encodeURIComponent(d.id)}/resolve`, { method: 'POST', body: { note: document.getElementById('note-' + d.id).value } });
    else return;
    const r = await run(btn, call);
    if (r !== undefined) { if (d.act !== 'csv') { toast('Saved'); show(); } }
  });
  show();
})();
