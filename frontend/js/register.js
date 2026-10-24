/* register.js — two sign-up forms: car owner and service center. */
'use strict';
(() => {
  const u = getUser();
  if (u && getToken()) { location.replace(HOME[u.role] || 'index.html'); return; }
  const msg = $('#msg');
  const next = new URLSearchParams(location.search).get('next') || '';
  const safeNext = /^[a-z-]+\.html(\?[\w=&%.-]*)?$/.test(next) ? next : '';

  function showTab(which) {
    $('#customerForm').hidden = which !== 'customer';
    $('#centerForm').hidden = which !== 'center';
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.as === which)));
    msg.innerHTML = '';
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.as)));
  showTab(new URLSearchParams(location.search).get('as') === 'center' ? 'center' : 'customer');

  function wire(form, path, after) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.innerHTML = '';
      const body = Object.fromEntries(new FormData(form).entries());
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const r = await api(path, { method: 'POST', body });
        saveSession(r.token, r.user);
        location.href = after;
      } catch (err) {
        showError(msg, err.message);
        btn.disabled = false;
        window.scrollTo(0, 0);
      }
    });
  }
  wire($('#customerForm'), '/auth/register', safeNext || 'find.html');
  wire($('#centerForm'), '/auth/register-center', 'center-setup.html');
})();
