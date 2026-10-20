(() => {
  const input = document.getElementById('password');
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');

  async function login() {
    if (!input.value) return;
    btn.disabled = true;
    err.hidden = true;
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) throw new Error(data.error || 'Sign in failed (HTTP ' + r.status + ')');
      location.href = '/';
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
      input.select();
    }
  }

  btn.addEventListener('click', login);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
})();
