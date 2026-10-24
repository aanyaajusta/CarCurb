/* login.js — log in, then go to the right dashboard for the person's role. */
'use strict';
(async () => {
  const u = getUser();
  if (u && getToken()) { location.replace(HOME[u.role] || 'index.html'); return; }

  const form = $('#form'), msg = $('#msg');
  const next = new URLSearchParams(location.search).get('next') || '';
  const safeNext = /^[a-z-]+\.html(\?[\w=&%.-]*)?$/.test(next) ? next : ''; // only our own pages

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.innerHTML = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('/auth/login', { method: 'POST', body: { identifier: $('#identifier').value, password: $('#password').value } });
      saveSession(r.token, r.user);
      location.href = r.user.role === 'customer' && safeNext ? safeNext : HOME[r.user.role];
    } catch (err) {
      showError(msg, err.message);
      btn.disabled = false;
    }
  });

  try {
    const cfg = await api('/config');
    if (cfg.demo) {
      $('#demo').hidden = false;
      $('#demo').addEventListener('click', (e) => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        $('#identifier').value = b.dataset.id;
        $('#password').value = 'carcurb123';
        form.requestSubmit();
      });
    }
  } catch (err) { /* demo box stays hidden */ }
})();
