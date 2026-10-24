/* center-setup.js — profile, services, pickup settings and the center's own drivers. */
'use strict';
(async () => {
  if (!requireRole('center')) return;
  const form = $('#profile');
  let c = null;

  async function load() {
    try { c = await api('/center/me'); } catch (e) { showError($('#banner'), e.message); return; }
    $('#banner').innerHTML = c.status === 'approved' ? '' : `<div class="alert alert-${c.status === 'pending' ? 'warn' : 'error'}">Status: <strong>${esc(c.status)}</strong>. ${c.status === 'pending' ? 'Customers can see your center once CarCurb approves it. You can finish setup now.' : 'Please contact CarCurb support.'}</div>`;
    for (const k of ['name', 'area', 'phone', 'address', 'open', 'close', 'capacity', 'upiId', 'lat', 'lng', 'pickupFee']) form.elements[k].value = c[k] == null ? '' : c[k];
    form.elements.pickupEnabled.checked = c.pickupEnabled;
    $('#services').innerHTML = c.services.length ? c.services.map((s) => `<div class="row" data-sid="${esc(s.id)}"><input class="s-name" value="${esc(s.name)}" maxlength="60" style="flex:2;min-width:140px" aria-label="Service name"><input class="s-price" type="number" min="1" step="1" value="${s.price}" style="flex:1;min-width:90px" aria-label="Price"><button class="btn btn-ghost btn-sm" data-act="save-service">Save</button><button class="btn btn-danger btn-sm" data-act="del-service">Remove</button></div>`).join('') : '<p class="muted small">No services yet. Add your first one below.</p>';
    $('#drivers').innerHTML = c.drivers.length ? c.drivers.map((d) => `<div class="row between" data-did="${esc(d.id)}"><span><strong>${esc(d.name)}</strong> · ${esc(d.phone)} ${d.active ? '' : '<span class="pill pill-bad">inactive</span>'}</span><span class="row"><button class="btn btn-ghost btn-sm" data-act="reset-driver">Reset password</button><button class="btn btn-ghost btn-sm" data-act="toggle-driver" data-active="${d.active}">${d.active ? 'Deactivate' : 'Activate'}</button></span></div>`).join('') : '<p class="muted small">No drivers yet. Add one to offer pickup and drop.</p>';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements, body = {};
    for (const k of ['name', 'area', 'phone', 'address', 'open', 'close', 'capacity', 'upiId', 'lat', 'lng', 'pickupFee']) body[k] = f[k].value;
    body.pickupEnabled = f.pickupEnabled.checked;
    const r = await run(e.submitter, () => api('/center/me', { method: 'PUT', body }));
    if (r) { toast('Profile saved'); load(); }
  });
  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('Your browser cannot share its location.', true); return; }
    navigator.geolocation.getCurrentPosition((p) => { form.elements.lat.value = p.coords.latitude.toFixed(6); form.elements.lng.value = p.coords.longitude.toFixed(6); toast('Location filled in. Press Save profile.'); }, () => toast('Location is blocked in your browser.', true), { timeout: 10000 });
  });
  $('#serviceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    const r = await run(e.submitter, () => api('/center/services', { method: 'POST', body }));
    if (r) { e.target.reset(); toast('Service added'); load(); }
  });
  $('#driverForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    const r = await run(e.submitter, () => api('/center/drivers', { method: 'POST', body }));
    if (r) { e.target.reset(); toast('Driver added. Share the phone number and password with them.'); load(); }
  });
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('[data-sid],[data-did]');
    let call;
    if (btn.dataset.act === 'save-service') call = () => api('/center/services/' + encodeURIComponent(row.dataset.sid), { method: 'PUT', body: { name: row.querySelector('.s-name').value, price: row.querySelector('.s-price').value } });
    else if (btn.dataset.act === 'del-service') { if (!confirm('Remove this service? Existing bookings are not affected.')) return; call = () => api('/center/services/' + encodeURIComponent(row.dataset.sid), { method: 'DELETE' }); }
    else if (btn.dataset.act === 'toggle-driver') call = () => api('/center/drivers/' + encodeURIComponent(row.dataset.did), { method: 'PATCH', body: { active: btn.dataset.active !== 'true' } });
    else if (btn.dataset.act === 'reset-driver') { const pw = prompt('New password for this driver (8+ characters):'); if (!pw) return; call = () => api('/center/drivers/' + encodeURIComponent(row.dataset.did), { method: 'PATCH', body: { password: pw } }); }
    else return;
    const r = await run(btn, call);
    if (r !== undefined) { toast('Saved'); load(); }
  });
  load();
})();
