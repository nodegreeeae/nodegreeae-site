/* Login + storage for the portal. Replaces the old /api/portal backend: the same ops, saved in Supabase.
   The key below is the project's publishable key. It is meant to be public; row-level security decides who sees what. */
(function () {
  'use strict';
  var CFG = { url: 'https://bsxzrgzcabripwiowlqf.supabase.co', key: 'sb_publishable_wo5fRuHGsQsbw8dEMuzxXA_PQfPe73u' };
  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ndae-portal' } });
  var esc = PQ.esc, view = document.getElementById('view');
  var ME = null, CLIENT = null, STATE = null, REV = null;
  var FIELDS = ['done', 'accepted', 'm1', 'replied', 'm2', 'call', 'talked', 'm3', 'referred', 'booked', 'interview', 'fu'];
  var ID_RE = /^[A-Za-z0-9]{1,16}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/, LI_RE = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/[^\s"'<>]{1,180}$/i;
  var MAX_LOG = 3000, MAX_ITEMS = 4000, MAX_QUEUE_BYTES = 400000;

  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function fresh() { return { items: {}, log: [], reqs: [], extra: {}, mgr: {}, xn: 0, day: { i: 0, date: null, taps: 0, ts: null }, lastTap: null, lastSeen: null, firstSeen: null }; }
  function norm(s) { var f = fresh(), k; s = s || {}; for (k in f) if (s[k] == null || (typeof f[k] === 'object' && f[k] !== null && typeof s[k] !== 'object')) s[k] = f[k]; return s; }
  function rid() { var B = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', a = new Uint8Array(8), o = '', i; crypto.getRandomValues(a); for (i = 0; i < 8; i++) o += B[a[i] % 62]; return o; }
  function res(status, body) { return { status: status, body: body || {} }; }
  /* Turns a Supabase error into what the pages expect: throw = offline (they retry), 401 = signed out, 5xx = retry, 4xx = reload. */
  function failed(r) {
    if (!r.error) return null;
    var st = r.status || 0, msg = String(r.error.message || '');
    if (!st || /failed to fetch|networkerror|load failed|network request/i.test(msg)) throw new Error('offline');
    if (st === 401 || r.error.code === 'PGRST301' || r.error.code === 'PGRST303') return res(401, { error: 'signed_out' });
    return res(st >= 500 ? 503 : st, { error: r.error.code || 'error' });
  }

  /* ---------- sign in ---------- */
  var LOGIN = { step: 'email', email: '', msg: '', busy: false, sentAt: 0 }, AFTER = null;
  function shell(hide) { ['tabs', 'prog', 'refresh', 'tbar'].forEach(function (id) { var e = document.getElementById(id); if (e) e.hidden = hide; }); var a = document.getElementById('acct'); if (a && hide) a.hidden = true; }
  function loginView() {
    shell(true);
    var h = '<div class="center login">';
    if (LOGIN.step === 'email') {
      h += '<h2>Sign in</h2><p>Enter the email you gave Sam. You\'ll get a sign-in code.</p>' +
        '<form id="lg"><input class="txt" id="lg-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@email.com" value="' + esc(LOGIN.email) + '" required>' +
        '<div class="acts"><button class="b primary" type="submit"' + (LOGIN.busy ? ' disabled' : '') + '>' + (LOGIN.busy ? 'Sending…' : 'Email me a code') + '</button></div></form>';
    } else {
      h += '<h2>Check your email</h2><p>We sent a code to <b>' + esc(LOGIN.email) + '</b>. It can take a minute. Check spam if you don\'t see it.</p>' +
        '<form id="lg"><input class="txt code" id="lg-code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="8" placeholder="Code" required>' +
        '<div class="acts"><button class="b primary" type="submit"' + (LOGIN.busy ? ' disabled' : '') + '>' + (LOGIN.busy ? 'Checking…' : 'Sign in') + '</button></div></form>' +
        '<div class="acts"><button class="undo" id="lg-again">Send a new code</button><button class="undo" id="lg-back">Use a different email</button></div>';
    }
    if (LOGIN.msg) h += '<p class="lg-msg" role="alert">' + esc(LOGIN.msg) + '</p>';
    view.innerHTML = h + '</div>';
    var f = document.getElementById('lg'), inp = document.getElementById(LOGIN.step === 'email' ? 'lg-email' : 'lg-code');
    f.addEventListener('submit', function (e) { e.preventDefault(); if (LOGIN.busy) return; if (LOGIN.step === 'email') send(inp.value); else verify(inp.value); });
    var again = document.getElementById('lg-again'), back = document.getElementById('lg-back');
    if (again) again.addEventListener('click', function () { if (!LOGIN.busy) send(LOGIN.email); });
    if (back) back.addEventListener('click', function () { LOGIN = { step: 'email', email: LOGIN.email, msg: '', busy: false, sentAt: 0 }; loginView(); });
    if (LOGIN.step === 'code') try { inp.focus(); } catch (e) {}
  }
  function send(email) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { LOGIN.msg = 'That doesn\'t look like an email.'; return loginView(); }
    var wait = 60 - Math.floor((Date.now() - LOGIN.sentAt) / 1000);
    if (LOGIN.email === email && LOGIN.sentAt && wait > 0) { LOGIN.step = 'code'; LOGIN.msg = 'A code was just sent. You can ask for a new one in ' + wait + ' seconds.'; return loginView(); }
    LOGIN.email = email; LOGIN.busy = true; LOGIN.msg = ''; loginView();
    sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } }).then(function (r) {
      LOGIN.busy = false;
      if (r.error) {
        var st = r.error.status || 0;
        if (st === 429 || /rate limit|security purposes|seconds/i.test(r.error.message || '')) { LOGIN.msg = 'Too many tries. Wait a minute, then try again.'; if (LOGIN.sentAt) LOGIN.step = 'code'; }
        else if (!st || st >= 500) LOGIN.msg = 'Couldn\'t send the code. Check your connection and try again.';
        else LOGIN.msg = 'That email isn\'t set up. Use the one you gave Sam, or text him.';
        return loginView();
      }
      LOGIN.step = 'code'; LOGIN.sentAt = Date.now(); loginView();
    }, function () { LOGIN.busy = false; LOGIN.msg = 'Couldn\'t send the code. Check your connection and try again.'; loginView(); });
  }
  function verify(code) {
    code = String(code || '').replace(/\D/g, '');
    if (code.length < 6) { LOGIN.msg = 'Enter the full code from the email.'; return loginView(); }
    LOGIN.busy = true; LOGIN.msg = ''; loginView();
    sb.auth.verifyOtp({ email: LOGIN.email, token: code, type: 'email' }).then(function (r) {
      LOGIN.busy = false;
      if (r.error || !r.data || !r.data.session) {
        var st = r.error && r.error.status;
        LOGIN.msg = (r.error && !st) ? 'Couldn\'t check the code. Check your connection and try again.' : 'That code didn\'t work. Check it, or send a new one.';
        return loginView();
      }
      LOGIN = { step: 'email', email: '', msg: '', busy: false, sentAt: 0 };
      view.innerHTML = '<div class="center"><p>Loading…</p></div>';
      whoAmI(r.data.session);
    }, function () { LOGIN.busy = false; LOGIN.msg = 'Couldn\'t check the code. Check your connection and try again.'; loginView(); });
  }
  function signOut() { ME = CLIENT = STATE = null; REV = null; sb.auth.signOut().then(function () { location.href = '/portal/'; }, function () { location.href = '/portal/'; }); }
  function plainFail(title, text, btn, fn) {
    shell(true);
    view.innerHTML = '<div class="center"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' + (btn ? '<div class="acts" style="justify-content:center"><button class="b primary" id="pf">' + esc(btn) + '</button></div>' : '') + '</div>';
    if (btn) document.getElementById('pf').addEventListener('click', fn);
  }
  function whoAmI(session) {
    var email = String(session.user.email || '').toLowerCase();
    sb.from('clients').select('id,email,name,label,role').eq('email', email).maybeSingle().then(function (r) {
      var bad;
      try { bad = failed(r); } catch (e) { return plainFail('You\'re offline', 'Check your connection and try again.', 'Try again', function () { whoAmI(session); }); }
      if (bad && bad.status === 401) { return sb.auth.signOut().then(loginView, loginView); }
      if (bad) return plainFail('Couldn\'t load your page', 'Something went wrong on our side.', 'Try again', function () { whoAmI(session); });
      if (!r.data) return plainFail('This email isn\'t set up', email + ' isn\'t on the client list. Text Sam, or sign in with the email you gave him.', 'Use a different email', signOut);
      ME = r.data;
      var a = document.getElementById('acct');
      if (a) {
        a.innerHTML = 'Signed in as ' + esc(ME.email) + (ME.role === 'admin' ? ' · <a href="/portal/hq.html">Clients</a> · <a href="/portal/">My test page</a>' : '') + ' · <button class="undo" id="so">Sign out</button>';
        a.hidden = false; document.getElementById('so').addEventListener('click', signOut);
      }
      shell(false);
      if (AFTER) AFTER(ME);
    }, function () { plainFail('You\'re offline', 'Check your connection and try again.', 'Try again', function () { whoAmI(session); }); });
  }
  /* Makes sure someone is signed in and on the client list, then calls cb(me). Shows the sign-in screen if not. */
  PQ.start = function (cb) {
    AFTER = cb;
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) return loginView();
      whoAmI(s);
    }, function () { loginView(); });
  };
  PQ.me = function () { return ME; };
  PQ.signOut = signOut;

  /* ---------- a client's saved progress ---------- */
  function pull() {
    return sb.from('progress').select('state,rev').eq('client_id', CLIENT.id).maybeSingle().then(function (r) {
      var bad = failed(r); if (bad) return bad;
      STATE = norm(r.data ? r.data.state : null); REV = r.data ? r.data.rev : null; return null;
    });
  }
  /* Saves only if nobody else saved since we loaded (second phone, second tab). true = saved, false = someone else got there first. */
  function write(st) {
    var q = REV == null
      ? sb.from('progress').insert({ client_id: CLIENT.id, state: st, rev: 1 }).select('rev')
      : sb.from('progress').update({ state: st, rev: REV + 1, updated_at: new Date().toISOString() }).eq('client_id', CLIENT.id).eq('rev', REV).select('rev');
    return q.then(function (r) {
      if (r.error && r.error.code === '23505') return false;
      var bad = failed(r); if (bad) return bad;
      if (!r.data || !r.data.length) return false;
      REV = r.data[0].rev; return true;
    });
  }
  /* Same rules the old server had. Changes st in place; returns {status, body}. */
  function apply(st, b, now) {
    var op = b.op, id, co, name, url, list, total, found, i, set, it, k;
    if (op === 'tap') {
      id = String(b.id || ''); if (!ID_RE.test(id)) return res(400, { error: 'bad_id' });
      if (b.undo) { delete st.items[id]; st.log.push({ id: id, a: 'undo', t: now }); }
      else {
        set = Array.isArray(b.set) ? b.set.filter(function (f) { return FIELDS.indexOf(f) >= 0; }) : [];
        if (!set.length) return res(400, { error: 'bad_set' });
        if (!st.items[id] && Object.keys(st.items).length >= MAX_ITEMS) return res(413, { error: 'too_many' });
        it = st.items[id] || (st.items[id] = { t: {} }); if (!it.t) it.t = {};
        set.forEach(function (f) { if (!it[f]) { it[f] = true; it.t[f] = now; (it.d || (it.d = {}))[f] = (st.day && st.day.i) || 0; st.log.push({ id: id, a: f, t: now }); } });
      }
      if (st.log.length > MAX_LOG) st.log = st.log.slice(-MAX_LOG);
      if (!st.day.date && DATE_RE.test(b.d || '')) { st.day.date = b.d; st.day.ts = now; }
      st.day.taps = (st.day.taps || 0) + 1; st.lastTap = now;
      return res(200, { ok: true, item: st.items[id] || null, day: copy(st.day), now: now });
    }
    if (op === 'day') {
      i = Number(b.i); if (!Number.isInteger(i) || !DATE_RE.test(b.d || '')) return res(400, { error: 'bad_day' });
      if (i === st.day.i + 1) st.day = { i: i, date: b.d, taps: 0, ts: now };
      else if (i === st.day.i) st.day.date = b.d;
      else return res(409, { error: 'day_mismatch', day: copy(st.day) });
      return res(200, { ok: true, day: copy(st.day), now: now });
    }
    if (op === 'setmgr' || op === 'addrep') {
      co = Number(b.co); name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
      if (!Number.isInteger(co) || !CLIENT.queue.companies.some(function (c) { return c.n === co; })) return res(400, { error: 'bad_company' });
      if (name.length > 60) return res(400, { error: 'bad_name' });
      url = typeof b.url === 'string' ? b.url.trim() : ''; if (!LI_RE.test(url)) url = '';
      if (op === 'setmgr') {
        if (name) st.mgr[co] = { name: name, url: url, t: now }; else delete st.mgr[co];
        st.log.push({ id: 'co' + co, a: name ? 'setmgr' : 'clearmgr', t: now, v: name }); st.lastTap = now;
        return res(200, { ok: true, mgr: copy(st.mgr), now: now });
      }
      if (!name) return res(400, { error: 'bad_rep' });
      list = st.extra[co] || (st.extra[co] = []); total = 0; for (k in st.extra) total += st.extra[k].length;
      if (list.length >= 100 || total >= 600) return res(429, { error: 'too_many' });
      st.xn = (st.xn || 0) + 1; var rep = { id: 'x' + st.xn, name: name, url: url, d: st.day.i, t: now };
      list.push(rep); st.log.push({ id: rep.id, a: 'addrep', t: now }); st.lastTap = now;
      return res(200, { ok: true, rep: rep, extra: copy(st.extra), now: now });
    }
    if (op === 'delrep') {
      id = String(b.id || ''); if (!/^x\d{1,6}$/.test(id)) return res(400, { error: 'bad_id' });
      found = false;
      Object.keys(st.extra).forEach(function (c) { var n = st.extra[c].length; st.extra[c] = st.extra[c].filter(function (r) { return r.id !== id; }); if (st.extra[c].length !== n) found = true; if (!st.extra[c].length) delete st.extra[c]; });
      if (!found) return res(404, { error: 'no_such_rep' });
      delete st.items[id]; st.log.push({ id: id, a: 'delrep', t: now });
      return res(200, { ok: true, extra: copy(st.extra), now: now });
    }
    if (op === 'suggest') {
      var text = typeof b.text === 'string' ? b.text.trim() : '';
      if (!text || text.length > 2000) return res(400, { error: 'bad_text' });
      if (st.reqs.length >= 20) return res(429, { error: 'too_many' });
      st.reqs.push({ id: rid(), t: now, text: text }); st.log.push({ id: 'req', a: 'suggest', t: now }); st.lastTap = now;
      return res(200, { ok: true, reqs: copy(st.reqs), now: now });
    }
    if (op === 'test.next' && ME.role === 'admin') { st.day = { i: st.day.i + 1, date: PQ.localDate(), taps: 0, ts: now }; return res(200, { ok: true, day: copy(st.day), now: now }); }
    return res(400, { error: 'bad_op' });
  }
  function mutate(b, n) {
    var st = copy(STATE), out = apply(st, b, Date.now());
    if (out.status !== 200) return Promise.resolve(out);
    return write(st).then(function (w) {
      if (w === true) { STATE = st; return out; }
      if (w !== false) return w;
      if (n >= 3) return res(503, { error: 'busy' });
      return pull().then(function (bad) { return bad || mutate(b, n + 1); });
    });
  }
  function get(b) {
    var id = (b.ro && b.id) ? String(b.id) : ME.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(res(404));
    return sb.from('clients').select('id,name,label,queue').eq('id', id).maybeSingle().then(function (r) {
      var bad = failed(r); if (bad) return bad;
      if (!r.data) return res(404, { error: 'not_found' });
      CLIENT = r.data; if (!CLIENT.queue || !Array.isArray(CLIENT.queue.companies)) CLIENT.queue = { companies: [] };
      return pull().then(function (bad2) {
        if (bad2) return bad2;
        var now = Date.now(), body = function () { return res(200, { name: CLIENT.name, label: CLIENT.label || '', queue: CLIENT.queue, state: copy(STATE), now: now }); };
        // ro = Sam looking at a client's page. Never counts as the client opening it. An empty list has nothing to open yet.
        if (b.ro || !CLIENT.queue.companies.length || (STATE.lastSeen && now - STATE.lastSeen <= 5 * 60 * 1000)) return body();
        var st = copy(STATE); st.lastSeen = now; if (!st.firstSeen) st.firstSeen = now;
        return write(st).then(function (w) { if (w === true) STATE = st; return body(); }, function () { return body(); });
      });
    });
  }

  /* ---------- Sam's side ---------- */
  function checkQueue(queue) {
    if (!queue || !Array.isArray(queue.companies) || queue.companies.length > 80) return 'bad_queue';
    if (JSON.stringify(queue).length > MAX_QUEUE_BYTES) return 'too_big';
    var ids = {}, c, it, i, j;
    for (i = 0; i < queue.companies.length; i++) {
      c = queue.companies[i]; if (!c || !Array.isArray(c.items) || typeof c.name !== 'string') return 'bad_company';
      for (j = 0; j < c.items.length; j++) { it = c.items[j]; if (!it || !ID_RE.test(String(it.id)) || ids[it.id] || /^(x\d+|k\d+|co\d+|req)$/.test(String(it.id))) return 'bad_item_id'; ids[it.id] = 1; }
    }
    return null;
  }
  function admin(b) {
    var op = b.op, key = String(b.key || '');
    if (!ME || ME.role !== 'admin') return Promise.resolve(res(404, { error: 'not_found' }));
    if (op === 'admin.list') {
      return sb.from('clients').select('id,email,name,label,role,queue,created_at,updated_at').order('created_at', { ascending: true }).then(function (r) {
        var bad = failed(r); if (bad) return bad;
        return sb.from('progress').select('client_id,state,updated_at').then(function (p) {
          var bad2 = failed(p); if (bad2) return bad2;
          var by = {}; (p.data || []).forEach(function (x) { by[x.client_id] = x.state; });
          return res(200, { now: Date.now(), clients: (r.data || []).map(function (c) {
            return { key: c.id, email: c.email, role: c.role, name: c.name, label: c.label || '', createdAt: Date.parse(c.created_at), updatedAt: Date.parse(c.updated_at),
              queue: (c.queue && Array.isArray(c.queue.companies)) ? c.queue : { companies: [] }, state: norm(by[c.id] ? copy(by[c.id]) : null) };
          }) });
        });
      });
    }
    if (op === 'admin.put') {
      var row = {}, email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      if (b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) return Promise.resolve(res(400, { error: 'bad_name' })); row.name = b.name.trim(); }
      if (b.label !== undefined) row.label = typeof b.label === 'string' ? b.label.slice(0, 80) : '';
      if (b.queue !== undefined) { var qe = checkQueue(b.queue); if (qe) return Promise.resolve(res(qe === 'too_big' ? 413 : 400, { error: qe })); row.queue = b.queue; }
      if (email) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.resolve(res(400, { error: 'bad_email' })); row.email = email; }
      var q;
      if (b.key !== undefined) {
        if (!/^[0-9a-f-]{36}$/i.test(key)) return Promise.resolve(res(400, { error: 'bad_key' }));
        row.updated_at = new Date().toISOString();
        q = sb.from('clients').update(row).eq('id', key).select('id');
      } else {
        if (!row.name) return Promise.resolve(res(400, { error: 'bad_name' }));
        if (!row.email) return Promise.resolve(res(400, { error: 'bad_email' }));
        q = sb.from('clients').insert(row).select('id');
      }
      return q.then(function (r) {
        if (r.error && r.error.code === '23505') return res(409, { error: 'email_in_use' });
        var bad = failed(r); if (bad) return bad;
        if (!r.data || !r.data.length) return res(404, { error: 'no_such_client' });
        var out = res(200, { ok: true, key: r.data[0].id, created: b.key === undefined });
        if (!b.resetState) return out;
        return sb.from('progress').delete().eq('client_id', r.data[0].id).then(function (d) { return failed(d) || out; });
      });
    }
    if (!/^[0-9a-f-]{36}$/i.test(key)) return Promise.resolve(res(400, { error: 'bad_key' }));
    if (op === 'admin.reqs') {
      var done = Array.isArray(b.done) ? b.done.map(String) : [];
      return sb.from('progress').select('state,rev').eq('client_id', key).maybeSingle().then(function (r) {
        var bad = failed(r); if (bad) return bad;
        if (!r.data) return res(404, { error: 'no_such_client' });
        var st = norm(r.data.state); st.reqs = st.reqs.filter(function (x) { return done.indexOf(x.id) < 0; });
        return sb.from('progress').update({ state: st, rev: r.data.rev + 1, updated_at: new Date().toISOString() }).eq('client_id', key).eq('rev', r.data.rev).select('rev').then(function (u) {
          var bad2 = failed(u); if (bad2) return bad2;
          if (!u.data || !u.data.length) return res(503, { error: 'busy' });
          return res(200, { ok: true, reqs: st.reqs });
        });
      });
    }
    if (op === 'admin.del') return sb.from('clients').delete().eq('id', key).then(function (r) { return failed(r) || res(200, { ok: true }); });
    return Promise.resolve(res(400, { error: 'bad_op' }));
  }

  /* One call to the backend. Resolves {status, body}; rejects only when offline. */
  PQ.api = function (b) {
    return sb.auth.getSession().then(function (r) {
      if (!(r.data && r.data.session) || !ME) return res(401, { error: 'signed_out' });
      if (typeof b.op !== 'string') return res(400, { error: 'bad_op' });
      if (b.op.indexOf('admin.') === 0) return admin(b);
      if (b.op === 'get') return get(b);
      if (!CLIENT || !STATE) return res(409, { error: 'not_loaded' });
      if (b.op === 'test.reset') {
        if (ME.role !== 'admin' || CLIENT.id !== ME.id) return res(400, { error: 'bad_op' });
        return sb.from('progress').delete().eq('client_id', CLIENT.id).then(function (d) { var bad = failed(d); if (bad) return bad; STATE = fresh(); REV = null; return res(200, { ok: true }); });
      }
      return mutate(b, 0);
    });
  };
})();
