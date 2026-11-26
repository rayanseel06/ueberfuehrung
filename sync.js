// Sync über Supabase (REST, ohne Bibliothek). Ein Datensatz pro Nutzer in `app_state`, geschützt per Row Level Security.
// Die App bleibt ohne Netz voll nutzbar; Änderungen werden beim nächsten Kontakt zusammengeführt (Calc.mergeDocs).
(function (root) {
  'use strict';
  const cfg = root.SYNC_CONFIG || {};
  const AUTH_KEY = 'ueberfuehrung.auth';
  const enabled = !!(cfg.url && cfg.anonKey);
  let session = null, getDoc = null, setDoc = null, onStatus = () => {};
  let status = { state: enabled ? 'abgemeldet' : 'aus', text: '' };
  let running = null, timer = null, again = false, wired = false;

  try { session = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { session = null; }
  const setStatus = (state, text) => { status = { state, text: text || '', at: Date.now() }; onStatus(status); };
  const keep = (s) => { session = s; if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s)); else localStorage.removeItem(AUTH_KEY); };

  async function call(path, opts, token) {
    const res = await fetch(cfg.url.replace(/\/$/, '') + path, Object.assign({}, opts, {
      // Publishable Key nur als apikey; Bearer nur mit echtem Nutzer-Token
      headers: Object.assign({ apikey: cfg.anonKey, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, (opts && opts.headers) || {}),
    }));
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) { const err = new Error((body && (body.msg || body.message || body.error_description || body.error)) || 'HTTP ' + res.status); err.status = res.status; throw err; }
    return body;
  }
  const fromAuth = (b) => ({ access_token: b.access_token, refresh_token: b.refresh_token, expires_at: Date.now() + (b.expires_in || 3600) * 1000, user: { id: b.user.id, email: b.user.email } });

  async function token() {
    if (!session) return null;
    if (session.expires_at - 60000 > Date.now()) return session.access_token;
    try { keep(fromAuth(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) }))); }
    catch (e) { if (e.status === 400 || e.status === 401) { keep(null); setStatus('abgemeldet', 'Sitzung abgelaufen, bitte neu anmelden'); return null; } throw e; }
    return session.access_token;
  }

  async function syncOnce() {
    const t = await token(); if (!t) return;
    const uid = session.user.id, q = '/rest/v1/app_state?user_id=eq.' + encodeURIComponent(uid);
    for (let attempt = 0; attempt < 4; attempt++) {
      const rows = await call(q + '&select=data,version', { method: 'GET' }, t);
      const local = getDoc();
      if (!rows.length) {
        await call('/rest/v1/app_state', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, data: local, version: 1 }) }, t);
        return;
      }
      const row = rows[0];
      const merged = root.Calc.mergeDocs(local, row.data);
      setDoc(merged.doc, merged.warnungen);
      if (root.Calc.canonical(merged.doc) === root.Calc.canonical(row.data)) return;
      // nur schreiben, wenn niemand dazwischen geschrieben hat; sonst neu lesen und zusammenführen
      const upd = await call(q + '&version=eq.' + row.version, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data: merged.doc, version: row.version + 1, updated_at: new Date().toISOString() }) }, t);
      if (upd && upd.length) return;
    }
    throw new Error('Server-Stand ändert sich gerade, versuche es gleich noch einmal');
  }

  async function syncNow() {
    if (!enabled || !session) return;
    if (running) { again = true; return running; }
    setStatus('laeuft');
    running = (async () => {
      try {
        do { again = false; await syncOnce(); } while (again);
        if (session) setStatus('ok');
      } catch (e) {
        setStatus(navigator.onLine === false || e instanceof TypeError ? 'offline' : 'fehler', e.message);
      } finally { running = null; }
    })();
    return running;
  }

  function wire() {
    if (wired) return; wired = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    root.addEventListener('online', () => syncNow());
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  }

  root.Sync = {
    get enabled() { return enabled; },
    get user() { return session && session.user; },
    get status() { return status; },
    init(opts) {
      getDoc = opts.getDoc; setDoc = opts.setDoc; onStatus = opts.onStatus || onStatus;
      if (!enabled) return setStatus('aus');
      if (!session) return setStatus('abgemeldet');
      wire(); syncNow();
    },
    schedule() { if (!enabled || !session) return; clearTimeout(timer); timer = setTimeout(syncNow, 1500); },
    syncNow,
    async signIn(email, password) {
      keep(fromAuth(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) })));
      wire(); await syncNow();
    },
    async signUp(email, password) {
      const b = await call('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (b && b.access_token) { keep(fromAuth(b)); wire(); await syncNow(); return 'angemeldet'; }
      return 'bestaetigen';
    },
    async signOut() {
      const t = session && session.access_token;
      keep(null); setStatus('abgemeldet');
      if (t) call('/auth/v1/logout', { method: 'POST' }, t).catch(() => {});
    },
  };
})(window);
