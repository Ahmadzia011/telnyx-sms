(() => {
  const $ = (id) => document.getElementById(id);
  const POLL_MS = 5000;

  const state = {
    myNumber: '',
    conversations: [],
    selected: null,   // E.164 of the open conversation
    draft: null,      // new conversation with no messages yet
    messages: [],
    threadSig: '',
    filter: '',
    sending: false,
    forceScroll: false
  };

  // ---------- helpers ----------

  // Mirror of lib/phone.js. The server is the authority; this gives instant feedback.
  function normalizeUS(input) {
    if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Enter a phone number.' };
    const raw = input.trim();
    let digits = raw.replace(/\D/g, '');
    if (raw.startsWith('+') && !digits.startsWith('1')) return { ok: false, error: 'Only US numbers (+1) are supported.' };
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    if (digits.length !== 10) {
      return { ok: false, error: 'A US number needs 10 digits, for example (207) 337-4818. You entered ' + digits.length + '.' };
    }
    if (!/^[2-9]/.test(digits) || !/^[2-9]/.test(digits.slice(3))) {
      return { ok: false, error: 'That is not a valid US number. Area code and exchange cannot start with 0 or 1.' };
    }
    return { ok: true, number: '+1' + digits };
  }

  function formatNumber(e164) {
    const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
    return m ? '+1 (' + m[1] + ') ' + m[2] + '-' + m[3] : e164;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function formatTime(iso, short) {
    const d = new Date(iso);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay(d, new Date())) return time;
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return short ? date : date + ', ' + time;
  }

  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (r.status === 401) {
      location.href = '/login.html';
      throw new Error('Not signed in.');
    }
    let data = {};
    try { data = await r.json(); } catch (e) { /* non-JSON response */ }
    if (!r.ok || data.ok === false) throw new Error(data.error || 'Request failed (HTTP ' + r.status + ')');
    return data;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const AVATAR_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>';

  // ---------- sidebar ----------

  function visibleConversations() {
    const list = state.conversations.slice();
    if (state.draft && !list.some((c) => c.contact === state.draft)) {
      list.unshift({ contact: state.draft, last_body: '', last_at: null, unread: 0, last_direction: 'out', isDraft: true });
    }
    const q = state.filter.replace(/\D/g, '');
    return q ? list.filter((c) => c.contact.replace(/\D/g, '').includes(q)) : list;
  }

  function renderSidebar() {
    const ul = $('convList');
    const items = visibleConversations();
    ul.textContent = '';
    $('convEmpty').hidden = items.length > 0 || state.filter !== '';

    for (const c of items) {
      const li = el('li', 'conv');
      if (c.contact === state.selected) li.classList.add('active');
      if (c.unread > 0) li.classList.add('unread');

      const avatar = el('div', 'avatar');
      avatar.innerHTML = AVATAR_SVG; // static markup, no user data

      const main = el('div', 'conv-main');
      const top = el('div', 'conv-top');
      top.appendChild(el('span', 'conv-number', formatNumber(c.contact)));
      top.appendChild(el('span', 'conv-time', c.last_at ? formatTime(c.last_at, true) : ''));

      const bottom = el('div', 'conv-bottom');
      let preview = c.last_body || (c.isDraft ? 'New conversation' : '');
      if (c.last_body && c.last_direction === 'out') preview = 'You: ' + preview;
      bottom.appendChild(el('span', 'conv-preview', preview.replace(/\s+/g, ' ')));
      if (c.unread > 0) bottom.appendChild(el('span', 'badge', String(c.unread)));

      main.appendChild(top);
      main.appendChild(bottom);
      li.appendChild(avatar);
      li.appendChild(main);
      li.addEventListener('click', () => openConversation(c.contact));
      ul.appendChild(li);
    }
  }

  // ---------- thread ----------

  function renderThread() {
    const thread = $('thread');
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    thread.textContent = '';

    if (!state.messages.length) {
      thread.appendChild(el('div', 'thread-empty', 'No messages yet. Type below to send the first text.'));
    }

    for (const m of state.messages) {
      const out = m.direction === 'out';
      const wrap = el('div', 'msg ' + (out ? 'out' : 'in') + (out && m.status === 'failed' ? ' failed' : ''));
      wrap.appendChild(el('div', 'bubble', m.body || '(no text)'));

      const meta = el('div', 'meta');
      meta.appendChild(document.createTextNode(formatTime(m.created_at)));
      if (out) {
        const label = m.status === 'queued' ? 'sending' : m.status;
        meta.appendChild(document.createTextNode(' - '));
        meta.appendChild(el('span', m.status === 'failed' ? 'st-failed' : '', label));
      }
      wrap.appendChild(meta);
      if (out && m.status === 'failed' && m.error) wrap.appendChild(el('div', 'errtext', m.error));
      thread.appendChild(wrap);
    }

    if (state.forceScroll || nearBottom) thread.scrollTop = thread.scrollHeight;
    state.forceScroll = false;
  }

  function setBanner(text) {
    const b = $('banner');
    b.textContent = text || '';
    b.hidden = !text;
  }

  // ---------- data ----------

  async function refreshConversations() {
    const data = await api('/api/conversations');
    state.myNumber = data.myNumber;
    state.conversations = data.conversations;
    if (state.draft && state.conversations.some((c) => c.contact === state.draft)) state.draft = null;
    $('myNumber').textContent = state.myNumber ? 'Number: ' + formatNumber(state.myNumber) : '';
    renderSidebar();
  }

  async function markRead(contact) {
    try {
      await api('/api/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact })
      });
      const c = state.conversations.find((x) => x.contact === contact);
      if (c) { c.unread = 0; renderSidebar(); }
    } catch (e) {
      console.error(e);
    }
  }

  async function refreshThread() {
    const contact = state.selected;
    if (!contact) return;
    const data = await api('/api/messages?contact=' + encodeURIComponent(contact));
    if (state.selected !== contact) return; // user switched while loading

    const sig = JSON.stringify(data.messages.map((m) => [m.id, m.status, m.error]));
    if (sig !== state.threadSig) {
      state.threadSig = sig;
      state.messages = data.messages;
      renderThread();
    }
    if (data.messages.some((m) => m.direction === 'in' && !m.read)) await markRead(contact);
  }

  async function poll() {
    try {
      await refreshThread();      // first, so reading clears unread before the sidebar loads
      await refreshConversations();
      $('connStatus').hidden = true;
    } catch (e) {
      console.error(e);
      $('connStatus').hidden = false;
    }
  }

  // ---------- actions ----------

  async function openConversation(contact) {
    state.selected = contact;
    state.messages = [];
    state.threadSig = '';
    state.forceScroll = true;
    setBanner('');

    $('placeholder').hidden = true;
    $('chatView').hidden = false;
    $('chatHead').textContent = formatNumber(contact);
    renderThread();
    renderSidebar();

    try { await refreshThread(); await refreshConversations(); } catch (e) { setBanner(e.message); }
    $('input').focus();
  }

  async function send() {
    const input = $('input');
    const text = input.value.trim();
    if (!text || !state.selected || state.sending) return;

    state.sending = true;
    $('sendBtn').disabled = true;
    setBanner('');
    try {
      await api('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: state.selected, text })
      });
      input.value = '';
      autosize();
    } catch (e) {
      setBanner(e.message); // the real error from Telnyx, or from validation
    } finally {
      state.sending = false;
      $('sendBtn').disabled = false;
    }
    state.forceScroll = true;
    try { await refreshThread(); await refreshConversations(); } catch (e) { console.error(e); }
    input.focus();
  }

  function autosize() {
    const i = $('input');
    i.style.height = 'auto';
    i.style.height = Math.min(i.scrollHeight, 120) + 'px';
  }

  // ---------- new conversation dialog ----------

  function showNewDialog() {
    $('newNumber').value = '';
    $('newError').hidden = true;
    $('newDialog').showModal();
    $('newNumber').focus();
  }

  function startNew() {
    const norm = normalizeUS($('newNumber').value);
    if (!norm.ok) {
      $('newError').textContent = norm.error;
      $('newError').hidden = false;
      return;
    }
    $('newDialog').close();
    if (!state.conversations.some((c) => c.contact === norm.number)) state.draft = norm.number;
    state.filter = '';
    $('search').value = '';
    openConversation(norm.number);
  }

  // ---------- wiring ----------

  $('signOut').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    location.href = '/login.html';
  });

  $('newBtn').addEventListener('click', showNewDialog);
  $('newCancel').addEventListener('click', () => $('newDialog').close());
  $('newStart').addEventListener('click', startNew);
  $('newNumber').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); startNew(); }
  });

  $('search').addEventListener('input', (e) => { state.filter = e.target.value; renderSidebar(); });

  $('sendBtn').addEventListener('click', send);
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('input').addEventListener('input', () => { autosize(); if (!$('banner').hidden) setBanner(''); });

  let polling = false;
  setInterval(async () => {
    if (polling || document.hidden) return;
    polling = true;
    try { await poll(); } finally { polling = false; }
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  poll();
})();
