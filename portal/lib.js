/* Shared logic for the client page (/q/) and Sam's dashboard (/hq/). Plain script, no build step. */
(function (g) {
  'use strict';
  var PQ = {};
  PQ.esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  PQ.marked = function (s) { return PQ.esc(s).replace(/\[[^\]]+\]/g, function (m) { return '<mark>' + m + '</mark>'; }); };
  PQ.hasBlank = function (s) { return /\[[^\]]+\]/.test(s || ''); };
  PQ.first = function (n) { return String(n).split(' ')[0]; };
  PQ.pad = function (n) { return (n < 10 ? '0' : '') + n; };
  PQ.localDate = function (d) { d = d || new Date(); return d.getFullYear() + '-' + PQ.pad(d.getMonth() + 1) + '-' + PQ.pad(d.getDate()); };

  PQ.st = function (state, id) { return (state.items && state.items[id]) || {}; };
  PQ.dayOf = function (co, it) { return it.off == null ? null : (co.start || 0) + it.off; };
  PQ.each = function (queue, fn) { queue.companies.forEach(function (co) { co.items.forEach(function (it) { fn(co, it); }); }); };
  PQ.find = function (queue, id) { var r = null; PQ.each(queue, function (co, it) { if (it.id === id) r = { co: co, it: it }; }); return r; };
  PQ.search = function (words) { return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(words); };
  /* Who's hiring at this company. A name the client got from a rep (state.mgr) beats the one Sam listed.
     Sam only lists a manager after checking their LinkedIn shows a current sales development manager title. */
  PQ.manager = function (co, state) {
    var set = state && state.mgr && state.mgr[co.n], listed = co.mgrs || [];
    if (set && set.name) {
      var hit = listed.filter(function (m) { return m.name.toLowerCase() === set.name.toLowerCase(); })[0];
      return { name: set.name, first: PQ.first(set.name), role: hit ? hit.role : 'Hiring manager (a rep told you)', url: set.url || (hit && hit.url) || '', fromRep: true, listed: !!hit };
    }
    if (listed.length) return { name: listed[0].name, first: listed[0].first || PQ.first(listed[0].name), role: listed[0].role, url: listed[0].url, fromRep: false, listed: true };
    return null;
  };
  PQ.question = function (co, state, withRole) {
    var m = PQ.manager(co, state), listed = co.mgrs || [], it = withRole ? 'for the ' + (co.seat || 'SDR') + ' role' : 'for it';
    if (m && m.fromRep) return 'is ' + m.first + ' the one hiring ' + it + ', or is it someone else?';
    if (listed.length > 1) return 'is ' + (listed[0].first || PQ.first(listed[0].name)) + ' or ' + (listed[1].first || PQ.first(listed[1].name)) + ' the one hiring ' + it + '?';
    if (m) return 'is ' + m.first + ' the one hiring ' + it + ', or is it someone else?';
    return 'who\'s the one hiring ' + it + ' on your team?';
  };
  /* Builds what the client actually sees: Sam's queue + reps they added + the manager filled into every message.
     Steps that need a manager (email, call, bump) stay out until one is known. Everything else works off this. */
  PQ.merge = function (queue, state) {
    var ex = (state && state.extra) || {}, out = {}, k;
    for (k in queue) out[k] = queue[k];
    out.companies = queue.companies.map(function (co) {
      var m = PQ.manager(co, state), q = PQ.question(co, state, false), qr = PQ.question(co, state, true);
      // {rep}: the rep who talked to the client (call done or referred). Call, email and manager message are written around them.
      var talk = null, ref = null;
      co.items.concat((ex[co.n] || []).map(function (r) { return { id: r.id, kind: 'rep', name: r.name }; })).forEach(function (it) {
        if (it.kind !== 'rep' || it.find) return; var s = PQ.st(state, it.id);
        if ((s.talked || s.referred) && !talk) talk = PQ.first(it.name); if (s.referred && !ref) ref = PQ.first(it.name);
      });
      var fill = function (s) {
        if (s == null) return s;
        return String(s).replace(/\{qr\}/g, qr).replace(/\{q\}/g, q).replace(/\{mgr\}/g, m ? m.first : '[Name]').replace(/\{mgrfull\}/g, m ? m.name + ', ' + m.role : '').replace(/\{rep\}/g, talk || ref || '[Rep]');
      };
      var fillItem = function (it) {
        var c = {}, f; for (f in it) c[f] = it[f];
        if (c.scriptB && !talk) c.script = c.scriptB; if (c.bodyB && !talk) c.body = c.bodyB;
        if (c.textB && !ref) { c.text = c.textB; c.textShort = c.textShortB; }
        ['name', 'role', 'm1', 'm2', 'callq', 'm3', 'ref', 'subject', 'body', 'script', 'text', 'textShort', 'dm', 'fu'].forEach(function (f) { if (c[f] != null) c[f] = fill(c[f]); });
        return c;
      };
      var items = co.items.filter(function (it) { return !it.nm || m; }).map(fillItem);
      // A manager a rep named who isn't one Sam listed gets their own connect step.
      if (m && m.fromRep && !m.listed) {
        var at = -1; items.forEach(function (it, i) { if (it.kind === 'rep' || it.kind === 'mgr') at = i; });
        items.splice(at + 1, 0, { id: 'k' + co.n, kind: 'mgr', off: 0, name: m.name, role: 'Hiring manager. A rep told you.', url: m.url || PQ.search(m.name + ' ' + (co.short || co.name)), dm: co.dm ? fill(co.dm) : null, fu: co.fum ? fill(co.fum) : null });
      }
      var list = ex[co.n] || [];
      if (list.length && co.tpl) {
        var rat = -1; items.forEach(function (it, i) { if (it.kind === 'rep') rat = i; });
        var add = list.map(function (r) {
          var f1 = PQ.first(r.name), sub = function (s) { return fill(String(s || '').replace(/\{first\}/g, f1)); };
          return { id: r.id, kind: 'rep', extra: true, off: Math.max(0, (r.d || 0) - (co.start || 0)), name: r.name, role: 'You added this rep.',
            url: r.url || PQ.search(r.name + ' ' + (co.short || co.name)), m1: sub(co.tpl.m1), m2: sub(co.tpl.m2), callq: sub(co.tpl.callq), m3: sub(co.tpl.m3), ref: sub(co.tpl.ref), fu: sub(co.tpl.fu) };
        });
        Array.prototype.splice.apply(items, [rat + 1, 0].concat(add));
      }
      var c2 = {}, j; for (j in co) c2[j] = co[j]; c2.items = items; c2.mgr = m; c2.repTalk = talk; c2.repRef = ref;
      c2.unlocked = !!talk || !!(m && m.fromRep); // a rep has told them who's hiring: manager message + call open up
      return c2;
    });
    return out;
  };
  PQ.lastDay = function (queue) { var m = 0; PQ.each(queue, function (co, it) { var d = PQ.dayOf(co, it); if (d != null && d > m) m = d; }); return m; };
  PQ.interview = function (state, co) { return !!PQ.st(state, 'co' + co.n).interview; };

  /* Rep flow: 0 not started, 1 waiting to accept, 2 send #1, 3 waiting on reply, 4 send #2 (10-min ask),
     5 waiting on a time, 6 call booked, 7 send thank-you, 8 waiting on the referral, 9 referred. */
  PQ.repStage = function (s) {
    if (!s.done) return 0; if (!s.accepted) return 1; if (!s.m1) return 2; if (!s.replied) return 3;
    // v5: no separate "ask for a time" message, they set the call up themselves.
    if (!s.call) return 5; if (!s.talked) return 6; if (!s.m3) return 7; if (!s.referred) return 8; return 9;
  };
  PQ.repActs = { 2: 1, 5: 1, 6: 1, 7: 1 }; // stages where the client has something to do right now (v5: 5 = they replied, set up the call)

  PQ.bumpHidden = function (state, co) {
    if (PQ.interview(state, co)) return true;
    return co.items.some(function (x) { return x.kind === 'call' && PQ.st(state, x.id).booked; });
  };

  /* Follow-ups: one nudge, FU_DAYS after a message with no reply. Days are the client's worked days or calendar days,
     whichever is larger, so it works for people who open it daily and for people who skip a few days. */
  PQ.FU_DAYS = 2; PQ.FU_KEEP = 4;
  PQ.fuBase = function (it, s) {
    if (!it.fu || s.replied) return null;
    if (it.kind === 'rep' || it.kind === 'mgr') return s.m1 ? 'm1' : null;
    if (it.kind === 'rec') return s.done ? 'done' : null;
    return null;
  };
  PQ.since = function (state, s, f, now) {
    var d = (s.d && s.d[f] != null) ? ((state.day && state.day.i) || 0) - s.d[f] : 0;
    var c = (s.t && s.t[f]) ? Math.floor(((now || Date.now()) - s.t[f]) / 86400000) : 0;
    return Math.max(d, c);
  };
  PQ.fuDue = function (state, co, it, now) {
    var s = PQ.st(state, it.id), f = PQ.fuBase(it, s);
    if (!f || s.fu) return false;
    if (it.kind !== 'rep' && PQ.bumpHidden(state, co)) return false; // already talking to the manager
    // The main manager's follow-up is the Day 6 bump, so they don't get a second nudge here.
    if (it.kind === 'mgr' && co.mgr && co.mgr.name === it.name && co.items.some(function (x) { return x.kind === 'bump'; })) return false;
    return PQ.since(state, s, f, now) >= PQ.FU_DAYS;
  };
  /* After the follow-up, a silent rep stays under Waiting for a few more days, then drops off Today (still in Full list). */
  PQ.fuStale = function (state, it, now) { var s = PQ.st(state, it.id); return !!s.fu && !s.replied && PQ.since(state, s, 'fu', now) > PQ.FU_KEEP; };

  /* Everything the Today view shows, for the client's current day. */
  PQ.today = function (queue, state) {
    var d = (state.day && state.day.i) || 0, ts = (state.day && state.day.ts) || 0;
    var out = { d: d, preps: [], calls: [], bumps: [], applies: [], newCos: [], added: [], leftovers: [], act: [], wait: [], fu: [] };
    queue.companies.forEach(function (co) {
      var fresh = [], isNew = (co.start || 0) === d;
      co.items.forEach(function (it) {
        var s = PQ.st(state, it.id), day = PQ.dayOf(co, it), e = { co: co, it: it };
        // Call + email come early once a rep has named the manager; otherwise on day 6 as the fallback.
        if ((it.kind === 'call' || it.kind === 'email') && day > d && co.unlocked) {
          if (s.done && !(s.t && s.t.done >= ts)) return;
          out.calls.push(e); return;
        }
        if (it.kind === 'prep') { if (PQ.interview(state, co) && (!s.done || (s.t && s.t.done >= ts))) out.preps.push(e); return; }
        if (it.kind === 'bump' && PQ.bumpHidden(state, co) && !s.done) return;
        if (day === d) {
          if (it.kind === 'call' || (it.kind === 'email' && !isNew)) out.calls.push(e); else if (it.kind === 'bump') out.bumps.push(e);
          else if (it.kind === 'apply' && !isNew) out.applies.push(e); // apply through the referral, or directly after a week
          else if ((it.extra || it.wave > 1) && !isNew) out.added.push(e); // next wave of reps, or one the client added, at a company already started
          else fresh.push(it);
        } else if (day < d) {
          var doneToday = s.done && s.t && s.t.done >= ts;
          if (!s.done || doneToday) out.leftovers.push(e);
          else if (PQ.fuDue(state, co, it) || (s.fu && s.t && s.t.fu >= ts)) out.fu.push(e); // due, or sent today (so the day's count holds)
          else if (it.kind === 'rep') { var stg = PQ.repStage(s); if (stg >= 1 && stg <= 8 && !(stg === 3 && PQ.fuStale(state, it))) (PQ.repActs[stg] ? out.act : out.wait).push(e); }
          else if (it.kind === 'mgr' && it.dm) { var ms = PQ.repStage(s); if (ms === 1 || (ms === 2 && !co.unlocked) || (ms === 3 && !PQ.fuStale(state, it))) out.wait.push(e); else if (ms === 2) out.act.push(e); } // manager: waiting to accept, one message, waiting on a reply
        }
      });
      if (fresh.length) out.newCos.push({ co: co, items: fresh });
    });
    var T = out.preps.concat(out.calls, out.bumps, out.applies, out.leftovers, out.added);
    out.newCos.forEach(function (n) { n.items.forEach(function (it) { T.push({ co: n.co, it: it }); }); });
    out.total = T.length + out.fu.length;
    out.done = T.filter(function (e) { return PQ.st(state, e.it.id).done; }).length + out.fu.filter(function (e) { return PQ.st(state, e.it.id).fu; }).length;
    out.allDone = out.total > 0 && out.done === out.total;
    out.past = d > PQ.lastDay(queue);
    return out;
  };

  /* What tomorrow holds, for the teaser. */
  PQ.tomorrow = function (queue, state) {
    var d = ((state.day && state.day.i) || 0) + 1, calls = 0, bumps = 0, applies = 0, names = [];
    queue.companies.forEach(function (co) {
      var isNew = false;
      co.items.forEach(function (it) {
        var day = PQ.dayOf(co, it); if (day !== d) return;
        if (it.kind === 'call') calls++; else if (it.kind === 'bump') { if (!PQ.bumpHidden(state, co)) bumps++; } else if (it.kind === 'apply') applies++; else if (it.kind !== 'email' || (co.start || 0) === d) isNew = true;
      });
      if (isNew) names.push(co.name);
    });
    return { d: d, calls: calls, bumps: bumps, applies: applies, names: names, empty: !calls && !bumps && !applies && !names.length };
  };
  PQ.plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
  PQ.daySummary = function (t) {
    var parts = [];
    var nc = t.calls.filter(function (e) { return e.it.kind === 'call'; }).length;
    if (nc) parts.push(PQ.plural(nc, 'call'));
    if (t.newCos.length) parts.push(t.newCos.length + (t.newCos.length === 1 ? ' new company' : ' new companies'));
    if (t.bumps.length) parts.push(PQ.plural(t.bumps.length, 'bump'));
    if (t.applies && t.applies.length) parts.push(t.applies.length + ' to apply to');
    if (t.added.length) parts.push(t.added.length + ' more ' + (t.added.length === 1 ? 'rep' : 'reps'));
    if (t.leftovers.length) parts.push(t.leftovers.length + ' left over');
    if (t.fu && t.fu.length) parts.push(PQ.plural(t.fu.length, 'follow-up'));
    if (t.preps.length) parts.push('interview prep');
    return parts.join(' · ');
  };

  /* Funnel numbers across the whole list. */
  PQ.totals = function (queue, state) {
    var t = { steps: 0, sent: 0, accepted: 0, replies: 0, repCalls: 0, referrals: 0, meetings: 0, interviews: 0, started: 0, companies: queue.companies.length };
    queue.companies.forEach(function (co) {
      var any = false;
      co.items.forEach(function (it) {
        var s = PQ.st(state, it.id);
        if (it.kind !== 'prep') t.steps++;
        if (s.done) { any = true; if (it.kind !== 'prep') t.sent++; }
        if (s.accepted) t.accepted++; if (s.replied) t.replies++; if (s.call) t.repCalls++; if (s.referred) t.referrals++; if (s.booked) t.meetings++;
      });
      if (PQ.interview(state, co)) { t.interviews++; any = true; }
      if (any) t.started++;
    });
    return t;
  };

  /* Taps per calendar day (viewer's local time) for the last n days, oldest first. */
  PQ.activity = function (state, n, now) {
    var days = [], map = {}, i, base = new Date(now || Date.now());
    for (i = n - 1; i >= 0; i--) { var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i); var k = PQ.localDate(d); map[k] = days.length; days.push({ date: k, label: 'SMTWTFS'.charAt(d.getDay()), n: 0 }); }
    (state.log || []).forEach(function (e) { if (e.a === 'undo') return; var k = PQ.localDate(new Date(e.t)); if (map[k] != null) days[map[k]].n++; });
    return days;
  };
  PQ.rel = function (ts, now) {
    if (!ts) return 'never'; var s = Math.max(0, ((now || Date.now()) - ts) / 1000);
    if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' hr ago';
    var d = Math.round(s / 86400); return d + (d === 1 ? ' day ago' : ' days ago');
  };
  PQ.ACTS = { done: 'done', accepted: 'they accepted', m1: 'sent message 1', replied: 'they replied', m2: 'locked in a time', call: 'rep call booked', talked: 'rep call done',
    m3: 'sent thank-you', referred: 'got the referral', booked: 'manager meeting booked', interview: 'INTERVIEW BOOKED', fu: 'sent a voice memo', undo: 'undid' };
  PQ.describe = function (queue, e) {
    if (e.a === 'suggest') return 'Sent companies for you to check';
    if (e.a === 'delrep') return 'Removed a rep they had added';
    if (e.a === 'setmgr' || e.a === 'clearmgr') { var mc = /^co(\d+)$/.exec(e.id), cc = mc && queue.companies.filter(function (c) { return String(c.n) === mc[1]; })[0];
      return (cc ? cc.name : 'A company') + ' · ' + (e.a === 'setmgr' ? 'hiring manager is ' + (e.v || '?') + ' (from a rep)' : 'cleared the hiring manager'); }
    var f = PQ.find(queue, e.id), who;
    if (e.a === 'addrep') return 'Added a rep: ' + (f ? f.it.name + ' (' + f.co.name + ')' : 'since removed');
    if (f) who = f.it.name + (f.it.name.indexOf(f.co.name) < 0 && f.it.name.indexOf('(') < 0 ? ' (' + f.co.name + ')' : '');
    else { var m = /^co(\d+)$/.exec(e.id); var co = m && queue.companies.filter(function (c) { return String(c.n) === m[1]; })[0]; who = co ? co.name : e.id; }
    return who + ' · ' + (PQ.ACTS[e.a] || e.a);
  };

  /* One call to the backend. Resolves {status, body}; never throws on HTTP errors. */
  PQ.api = function (body, headers) {
    var h = { 'content-type': 'application/json' }, k; for (k in headers) h[k] = headers[k];
    return fetch('/api/portal', { method: 'POST', headers: h, body: JSON.stringify(body), cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: {} }; }); });
  };
  PQ.copy = function (text, btn) {
    function ok() { if (!btn) return; var o = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = o; }, 1400); }
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); ok(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  };
  g.PQ = PQ;
})(typeof window !== 'undefined' ? window : globalThis);
