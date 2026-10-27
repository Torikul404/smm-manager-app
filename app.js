"use strict";
/* SMM Manager — ১০ প্যানেল, অর্ডার/স্পিড ট্র্যাকার, কোয়ালিটি বিশ্লেষণ। সব লজিক এই ফাইলে; আপলোড করলেই আপডেট। */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const HOSTS = ["smmxpanel.com", "getmyfollow.com", "smmsun.com", "smmstarpro.com", "smmgen.com", "socialpanel.pro", "smmrx.com", "bdsmmpanel.com", "amarboost.com", "growfollows.com"];
const FINAL = ["completed", "canceled", "cancelled", "refunded", "partial", "fail", "failed"];
const S = { cfg: { proxy: "", pw: "" }, panels: [], pass: "" };   // ভল্টে এনক্রিপ্টেড থাকে (কী সহ)
let D = { orders: [], tests: [] };                                   // অর্ডার লগ (কী ছাড়া)
const UI = { tab: "track", f: "all", pid: "", q: "", cat: "", busy: false };
const uid = () => Math.random().toString(36).slice(2, 9);
const pan = id => S.panels.find(p => p.id === id);
const saveD = () => { try { localStorage.smm_data = JSON.stringify(D); } catch (e) {} };
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2600); }

/* ---------- IndexedDB (সার্ভিস ক্যাশ) ---------- */
const idb = (m, k, v) => new Promise(r => {
  const q = indexedDB.open("smm", 1);
  q.onupgradeneeded = () => q.result.createObjectStore("kv");
  q.onerror = () => r();
  q.onsuccess = () => { const db = q.result, t = db.transaction("kv", m === "get" ? "readonly" : "readwrite"), s = t.objectStore("kv"), x = m === "get" ? s.get(k) : s.put(v, k); t.oncomplete = () => { r(m === "get" ? x.result : true); db.close(); }; t.onerror = () => r(); };
});

/* ---------- এনক্রিপ্টেড ভল্ট (API Key নিরাপদ) ---------- */
const b2s = b => { let s = ""; new Uint8Array(b).forEach(c => s += String.fromCharCode(c)); return btoa(s); };
const s2b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function dk(pass, salt) {
  const m = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, m, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal() {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), k = await dk(S.pass, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify({ cfg: S.cfg, panels: S.panels })));
  localStorage.smm_vault = JSON.stringify({ s: b2s(salt), i: b2s(iv), c: b2s(ct) });
}
async function unseal(pass) {
  const v = JSON.parse(localStorage.smm_vault), k = await dk(pass, s2b(v.s));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: s2b(v.i) }, k, s2b(v.c));
  const o = JSON.parse(new TextDecoder().decode(pt)); S.cfg = o.cfg; S.panels = o.panels; S.pass = pass;
}

/* ---------- প্রক্সি কল (একসাথে অনেকগুলো প্যারালাল) ---------- */
const NATIVE = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp);
async function call(calls) {
  if (NATIVE()) {   // APK: সরাসরি প্যানেল কল (নেটিভ HTTP, CORS লাগে না, প্রক্সি লাগে না)
    const H = window.Capacitor.Plugins.CapacitorHttp;
    return Promise.all(calls.map(async c => {
      try {
        const r = await H.post({ url: c.p.api, headers: { "Content-Type": "application/x-www-form-urlencoded" }, data: Object.assign({ key: c.p.key }, c.params), connectTimeout: 20000, readTimeout: 30000 });
        return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      } catch (e) { return { error: "প্যানেলের উত্তর বোঝা যায়নি" }; }
    }));
  }
  if (!S.cfg.proxy) throw new Error("Settings-এ প্রক্সি URL দিন");
  const r = await fetch(S.cfg.proxy, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ pw: S.cfg.pw, calls: calls.map(c => ({ url: c.p.api, params: Object.assign({ key: c.p.key }, c.params) })) }) });
  const a = await r.json();
  if (!Array.isArray(a)) throw new Error(a && a.error === "unauthorized" ? "প্রক্সি পাসওয়ার্ড ভুল" : (a && a.error) || "প্রক্সি ত্রুটি");
  return a.map(t => { try { return JSON.parse(t); } catch (e) { return { error: "প্যানেলের উত্তর বোঝা যায়নি" }; } });
}
const one = async (p, params) => (await call([{ p, params }]))[0];

/* ---------- মেট্রিক্স: স্পিড, ETA, ধীর অর্ডার ---------- */
const isFinal = s => FINAL.includes(String(s || "").toLowerCase());
function metrics(o, now = Date.now()) {
  const q = +o.qty || 0, rem = o.remains == null || o.remains === "" ? null : +o.remains;
  const done = /^completed$/i.test(o.status || "");
  const del = done ? q : rem == null ? 0 : Math.max(0, q - rem);
  const s = (o.snaps || []).slice(-12); let rate = 0;
  if (s.length >= 2) { const a = s[0], b = s[s.length - 1]; if (b.d > a.d && b.t > a.t) rate = (b.d - a.d) / ((b.t - a.t) / 36e5); }
  const age = ((o.done || now) - o.t0) / 36e5;
  if (!rate && del > 0 && age > 0) rate = del / age;
  const eta = !done && rate > 0 && rem != null ? rem / rate : null;
  let slow = false;
  if (!isFinal(o.status)) {
    if (eta != null && eta > 48) slow = true;
    if (del === 0 && age > 3 && /progress|pending|processing/i.test(o.status || "")) slow = true;
  }
  return { del, rate, eta, age, slow, done, pct: q ? Math.min(100, Math.round(del / q * 100)) : 0, total: o.done ? (o.done - o.t0) / 36e5 : null };
}
const fh = h => h == null || !isFinite(h) ? "—" : h < 1 ? Math.max(1, Math.round(h * 60)) + " মিনিট" : h < 48 ? h.toFixed(1) + " ঘণ্টা" : (h / 24).toFixed(1) + " দিন";
const fr = r => r > 0 ? (r >= 100 ? Math.round(r) : r.toFixed(1)) + "/ঘ" : "—";
const kind = o => { const s = String(o.status || "").toLowerCase(); return s === "completed" ? "done" : ["partial", "canceled", "cancelled", "refunded", "fail", "failed"].includes(s) ? "bad" : "run"; };

/* ---------- কোয়ালিটি স্কোর ---------- */
function qscore(t) {
  const o = D.orders.find(x => x.id === t.oid); if (!o) return null;
  if (!t.cps.length) return { pending: true, o };
  const m = metrics(o), last = t.cps[t.cps.length - 1], del = m.del || +o.qty || 1;
  const net = last.n - t.before, ret = Math.max(0, Math.min(1, net / del));
  const rf = Math.min(20, (o.refills || 0) * 10);
  const sp = !m.done ? null : m.total <= 1 ? 100 : m.total <= 6 ? 85 : m.total <= 24 ? 65 : m.total <= 72 ? 40 : 20;
  const score = Math.max(0, Math.round(sp == null ? ret * 100 - rf : ret * 70 + sp * .3 - rf));
  return { o, ret, drop: 1 - ret, net, del, sp, rf, score, hrs: m.total };
}
const grade = s => s >= 80 ? ["ভালো", "ok"] : s >= 60 ? ["মোটামুটি", "warn"] : ["দুর্বল", "bad"];

/* ---------- পোলিং ---------- */
async function poll(manual) {
  if (UI.busy) return; UI.busy = true;
  try {
    const by = {};
    D.orders.filter(o => o.oid && !isFinal(o.status)).forEach(o => (by[o.pid] = by[o.pid] || []).push(o));
    const calls = [], meta = [];
    for (const pid in by) { const p = pan(pid); if (!p || !p.key) continue; for (let i = 0; i < by[pid].length; i += 100) { const ch = by[pid].slice(i, i + 100); calls.push({ p, params: { action: "status", orders: ch.map(o => o.oid).join(",") } }); meta.push(ch); } }
    if (!calls.length) { if (manual) toast("আপডেটের মতো চলমান অর্ডার নেই"); return; }
    const res = await call(calls), now = Date.now();
    res.forEach((r, i) => meta[i].forEach(o => {
      const x = r && (r[o.oid] || (meta[i].length === 1 && r.status ? r : null));
      if (!x) { o.err = (r && r.error) || "তথ্য আসেনি"; return; }
      if (x.error) { o.err = x.error; return; }
      o.err = ""; o.status = x.status; o.start = x.start_count; o.remains = x.remains; o.charge = x.charge;
      const d = Math.max(0, (+o.qty || 0) - (+x.remains || 0));
      (o.snaps = o.snaps || []).push({ t: now, d }); if (o.snaps.length > 40) o.snaps.shift();
      if (isFinal(x.status) && !o.done) o.done = now;
    }));
    saveD(); $("#upd").textContent = new Date().toLocaleTimeString("bn-BD", { hour: "numeric", minute: "2-digit" });
    if (manual) toast("আপডেট হয়েছে");
  } catch (e) { toast(e.message); } finally { UI.busy = false; render(); }
}

/* ---------- ভিউ ---------- */
const opts = (arr, sel, ph) => (ph ? `<option value="">${ph}</option>` : "") + arr.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`).join("");
const panOpts = (sel, ph) => opts(S.panels.map(p => [p.id, p.name + (p.main ? " ★" : "")]), sel, ph);

function vTrack() {
  const all = D.orders.map(o => ({ o, m: metrics(o) })).sort((a, b) => b.o.t0 - a.o.t0);
  const c = { run: 0, done: 0, slow: 0, bad: 0 };
  all.forEach(x => { c[kind(x.o)]++; if (x.m.slow) c.slow++; });
  const L = all.filter(x => UI.f === "all" || (UI.f === "slow" ? x.m.slow : kind(x.o) === UI.f) && (UI.pid ? x.o.pid === UI.pid : true)).filter(x => !UI.pid || x.o.pid === UI.pid);
  const tabs = [["all", "সব"], ["run", "চলমান"], ["slow", "ধীর"], ["done", "সম্পন্ন"], ["bad", "সমস্যা"]];
  return `<div class="sum"><div><b>${all.length}</b><span>মোট</span></div><div><b class="run">${c.run}</b><span>চলমান</span></div><div><b class="warn">${c.slow}</b><span>ধীর</span></div><div><b class="ok">${c.done}</b><span>সম্পন্ন</span></div></div>
  <div class="tabs">${tabs.map(([k, l]) => `<button data-a="f" data-v="${k}" class="${UI.f === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <select id="fpid" data-a="pidf" style="margin-bottom:10px">${panOpts(UI.pid, "সব প্যানেল")}</select>
  ${L.length ? L.map(({ o, m }) => card(o, m)).join("") : `<div class="empty">কোনো অর্ডার নেই।<br>“নতুন” ট্যাব থেকে অর্ডার দিন বা আগের অর্ডার ID যোগ করুন।</div>`}`;
}
function card(o, m) {
  const p = pan(o.pid), k = kind(o);
  const st = `<span class="chip ${k === "done" ? "ok" : k === "bad" ? "bad" : m.slow ? "warn" : "run"}">${esc(o.status || "অপেক্ষায়")}${m.slow ? " · ধীর" : ""}</span>`;
  return `<div class="card"><div class="row"><div class="t">${esc(p ? p.name : "?")} <span class="mut">#${esc(o.oid)}</span></div>${st}</div>
  <div class="mut">${esc(o.sname || "সার্ভিস " + o.sid)} · ${esc(o.qty)}${o.link ? " · " + esc(String(o.link).slice(0, 38)) : ""}</div>
  <div class="bar${m.slow ? " s" : ""}"><i style="width:${m.pct}%"></i></div>
  <div class="grid"><div><b>${m.pct}%</b><span>ডেলিভারি</span></div><div><b>${fr(m.rate)}</b><span>স্পিড</span></div><div><b>${m.done ? fh(m.total) : fh(m.eta)}</b><span>${m.done ? "মোট সময়" : "শেষ হতে"}</span></div><div><b>${o.start === undefined || o.start === "" ? "—" : esc(o.start)}</b><span>স্টার্ট কাউন্ট</span></div></div>
  ${o.err ? `<div class="bad mut" style="margin-top:6px">⚠ ${esc(o.err)}</div>` : ""}
  <div class="acts"><button data-a="refill" data-id="${o.id}">♻️ রিফিল</button><button data-a="cancel" data-id="${o.id}">✖ ক্যান্সেল</button><button data-a="qtest" data-id="${o.id}">⭐ কোয়ালিটি টেস্ট</button><button class="d" data-a="del" data-id="${o.id}">মুছুন</button></div></div>`;
}

function vSvc() {
  const p = pan(UI.pid) || S.panels[0]; if (!UI.pid && p) UI.pid = p.id;
  const list = (vSvc.cache && vSvc.cache.id === UI.pid) ? vSvc.cache.list : null;
  let h = `<div class="row" style="gap:6px"><select data-a="svcpan">${panOpts(UI.pid)}</select><button data-a="svcload" class="p">লোড</button></div>`;
  if (!list) return h + `<div class="empty">প্যানেল বেছে “লোড” চাপুন (একবার লোড হলে ক্যাশে থাকে)।</div>`;
  const cats = [...new Set(list.map(s => s.category))].sort();
  const q = UI.q.toLowerCase();
  const res = list.filter(s => (!UI.cat || s.category === UI.cat) && (!q || (s.name + " " + s.service + " " + s.category).toLowerCase().includes(q)));
  h += `<input id="sq" placeholder="সার্চ: নাম, ID, ক্যাটাগরি" value="${esc(UI.q)}" style="margin-top:8px"><select data-a="catf" style="margin-top:6px">${opts(cats.map(c => [c, c]), UI.cat, "সব ক্যাটাগরি")}</select>
  <div class="mut" style="margin:8px 2px">${res.length}টি সার্ভিস${res.length > 60 ? " · প্রথম ৬০টি" : ""}</div>`;
  return h + res.slice(0, 60).map(s => `<div class="card"><div class="t">${esc(s.name)}</div><div class="mut">#${esc(s.service)} · ${esc(s.category)}</div><div class="row" style="margin-top:6px"><div class="mut">রেট ${esc(s.rate)}/১০০০ · ${esc(s.min)}–${esc(s.max)}${s.refill ? " · ♻️" : ""}${s.cancel ? " · ✖✓" : ""}</div><button data-a="usesvc" data-sid="${esc(s.service)}" data-n="${esc(s.name)}">অর্ডার</button></div></div>`).join("");
}

function vNew() {
  const n = vNew.pre || {};
  return `<div class="card"><div class="t">নতুন অর্ডার</div>
  <label>প্যানেল</label><select id="np">${panOpts(n.pid || UI.pid)}</select>
  <label>সার্ভিস ID ${n.sname ? `<span class="ok">— ${esc(n.sname)}</span>` : ""}</label><input id="ns" inputmode="numeric" value="${esc(n.sid || "")}">
  <label>লিংক / ইউজারনেম</label><input id="nl" placeholder="https://instagram.com/…">
  <label>পরিমাণ</label><input id="nq" inputmode="numeric" value="1000">
  <div class="acts"><button class="p" data-a="place">অর্ডার দিন</button></div></div>
  <div class="card"><div class="t">আগের অর্ডার ট্র্যাকে যোগ করুন</div><div class="mut">প্যানেলে আগে দেওয়া অর্ডারের ID দিলে এখানে ট্র্যাক হবে</div>
  <label>প্যানেল</label><select id="xp">${panOpts("")}</select>
  <div class="two"><div><label>অর্ডার ID</label><input id="xo" inputmode="numeric"></div><div><label>পরিমাণ</label><input id="xq" inputmode="numeric"></div></div>
  <label>সার্ভিস ID (ঐচ্ছিক)</label><input id="xs" inputmode="numeric">
  <div class="acts"><button data-a="track">ট্র্যাক শুরু</button></div></div>`;
}

function vQual() {
  const T = D.tests.map(t => ({ t, q: qscore(t) })).filter(x => x.q);
  const rows = {}; T.forEach(({ t, q }) => { if (q.pending) return; const o = q.o, k = o.pid + "|" + o.sid; (rows[k] = rows[k] || { o, a: [] }).a.push(q); });
  const cmp = Object.values(rows).map(r => ({ r, s: Math.round(r.a.reduce((x, y) => x + y.score, 0) / r.a.length), ret: r.a.reduce((x, y) => x + y.ret, 0) / r.a.length })).sort((a, b) => b.s - a.s);
  let h = `<div class="mut" style="margin:0 2px 8px">কোনো অর্ডারের “⭐ কোয়ালিটি টেস্ট” চাপুন। অর্ডারের আগে আইডির ফলোয়ার সংখ্যা দিন, পরে ২৪ঘ/৭দিন পর বর্তমান সংখ্যা যোগ করুন। অ্যাপ নিজে ইনস্টাগ্রাম পড়তে পারে না, তাই সংখ্যাটা আপনাকে দিতে হবে।</div>`;
  if (!T.length) return h + `<div class="empty">এখনো কোনো টেস্ট নেই</div>`;
  h += T.map(({ t, q }) => {
    const o = q.o, p = pan(o.pid), g = q.pending ? null : grade(q.score);
    return `<div class="card"><div class="row"><div class="t">${esc(p ? p.name : "?")} <span class="mut">#${esc(o.sid)} · ${esc(o.qty)}</span></div>${g ? `<span class="score ${g[1]}">${q.score}</span>` : ""}</div>
    <div class="mut">${esc(o.sname || "")} · আগে ${esc(t.before)} জন</div>
    ${q.pending ? `<div class="warn" style="margin-top:6px">চেকপয়েন্ট যোগ করুন</div>` : `<div class="grid"><div><b class="${g[1]}">${g[0]}</b><span>রেটিং</span></div><div><b>${Math.round(q.ret * 100)}%</b><span>টিকে আছে</span></div><div><b>${Math.round(q.drop * 100)}%</b><span>ড্রপ</span></div><div><b>${q.hrs != null ? fh(q.hrs) : "চলমান"}</b><span>ডেলিভারি সময়</span></div></div>`}
    ${t.cps.length ? `<div class="mut" style="margin-top:6px">${t.cps.map(c => `${new Date(c.t).toLocaleDateString("bn-BD", { day: "numeric", month: "short" })}: ${c.n}`).join(" → ")}</div>` : ""}
    <div class="two" style="margin-top:8px"><input id="cp${t.id}" inputmode="numeric" placeholder="এখনকার ফলোয়ার সংখ্যা"><button data-a="addcp" data-id="${t.id}" class="p">যোগ করুন</button></div>
    <div class="acts"><button class="d" data-a="deltest" data-id="${t.id}">টেস্ট মুছুন</button></div></div>`;
  }).join("");
  if (cmp.length) h += `<div class="card"><div class="t">সার্ভিস তুলনা</div><table><tr><th>প্যানেল #সার্ভিস</th><th>স্কোর</th><th>টিকে</th><th>টেস্ট</th></tr>${cmp.map(x => `<tr><td>${esc((pan(x.r.o.pid) || {}).name)} #${esc(x.r.o.sid)}</td><td class="${grade(x.s)[1]}"><b>${x.s}</b></td><td>${Math.round(x.ret * 100)}%</td><td>${x.r.a.length}</td></tr>`).join("")}</table>
  <div class="mut" style="margin-top:6px">স্কোর = ৭০% টিকে থাকা + ৩০% ডেলিভারি স্পিড, প্রতি রিফিলে −১০।</div></div>`;
  return h;
}

function vSet() {
  return `${NATIVE() ? "" : `<div class="card"><div class="t">প্রক্সি (ব্রাউজারে চালালে লাগবে, APK-তে লাগে না)</div>
  <label>Web App URL</label><input id="cx" value="${esc(S.cfg.proxy)}" placeholder="https://script.google.com/macros/s/…/exec">
  <label>প্রক্সি পাসওয়ার্ড</label><input id="cw" type="password" value="${esc(S.cfg.pw)}"></div>`}
  ${S.panels.map(p => `<div class="card"><div class="row"><div class="t">${esc(p.name)}${p.main ? " ★" : ""}</div><span class="mut" id="bal${p.id}"></span></div>
  <label>API URL</label><input data-f="api" data-id="${p.id}" value="${esc(p.api)}">
  <label>Admin / API Key</label><input data-f="key" data-id="${p.id}" type="password" value="${esc(p.key)}" autocomplete="off">
  <div class="acts"><button data-a="bal" data-id="${p.id}">ব্যালেন্স দেখুন</button></div></div>`).join("")}
  <div class="acts"><button class="p" data-a="saveset">সেভ করুন</button><button data-a="export">ব্যাকআপ (কী ছাড়া)</button><button data-a="lock">🔒 লক</button></div>`;
}

const V = { track: vTrack, svc: vSvc, new: vNew, qual: vQual, set: vSet };
function render() {
  $$("#nav button").forEach(b => b.classList.toggle("on", b.dataset.t === UI.tab));
  const keep = $("#sq") === document.activeElement, pos = keep ? $("#sq").selectionStart : 0;
  if (UI.tab === "set" && document.activeElement && document.activeElement.tagName === "INPUT") return;   // টাইপ করার সময় রিফ্রেশ নয়
  $("#v").innerHTML = V[UI.tab]();
  if (keep) { const e = $("#sq"); e.focus(); e.setSelectionRange(pos, pos); }
}

/* ---------- অ্যাকশন ---------- */
const A = {
  f: d => { UI.f = d.v; render(); },
  pidf: () => { UI.pid = $("#fpid").value; render(); },
  svcpan: () => { UI.pid = $("[data-a=svcpan]").value; UI.cat = ""; render(); },
  catf: () => { UI.cat = $("[data-a=catf]").value; render(); },
  async svcload() {
    const p = pan($("[data-a=svcpan]").value); if (!p) return; UI.pid = p.id;
    const c = await idb("get", "svc_" + p.id);
    if (c && Date.now() - c.t < 6 * 36e5) { vSvc.cache = { id: p.id, list: c.list }; return render(); }
    toast("লোড হচ্ছে…");
    try { const r = await one(p, { action: "services" }); if (!Array.isArray(r)) throw new Error(r.error || "সার্ভিস তালিকা আসেনি"); await idb("set", "svc_" + p.id, { t: Date.now(), list: r }); vSvc.cache = { id: p.id, list: r }; render(); } catch (e) { toast(e.message); }
  },
  usesvc: d => { vNew.pre = { pid: UI.pid, sid: d.sid, sname: d.n }; UI.tab = "new"; render(); },
  async place() {
    const p = pan($("#np").value), sid = $("#ns").value.trim(), link = $("#nl").value.trim(), qty = +$("#nq").value;
    if (!p || !sid || !link || !qty) return toast("সব ঘর পূরণ করুন");
    try {
      const r = await one(p, { action: "add", service: sid, link, quantity: qty });
      if (!r.order) throw new Error(r.error || "অর্ডার হয়নি");
      D.orders.push({ id: uid(), pid: p.id, oid: String(r.order), sid, sname: (vNew.pre || {}).sname || "", link, qty, t0: Date.now(), status: "Pending", snaps: [], refills: 0 });
      saveD(); vNew.pre = null; UI.tab = "track"; toast("অর্ডার হয়েছে #" + r.order); render(); poll();
    } catch (e) { toast(e.message); }
  },
  track() {
    const p = pan($("#xp").value), oid = $("#xo").value.trim(); if (!p || !oid) return toast("প্যানেল ও অর্ডার ID দিন");
    D.orders.push({ id: uid(), pid: p.id, oid, sid: $("#xs").value.trim(), qty: +$("#xq").value || 0, t0: Date.now(), status: "", snaps: [], refills: 0 });
    saveD(); UI.tab = "track"; render(); poll(true);
  },
  async refill(d) {
    const o = D.orders.find(x => x.id === d.id), p = pan(o.pid);
    try { const r = await one(p, { action: "refill", order: o.oid }); if (r.error) throw new Error(typeof r.error === "string" ? r.error : "রিফিল হয়নি"); o.refills = (o.refills || 0) + 1; saveD(); toast("রিফিল অনুরোধ গেছে"); render(); } catch (e) { toast(e.message); }
  },
  async cancel(d) {
    if (!confirm("এই অর্ডার ক্যান্সেল করবেন?")) return;
    const o = D.orders.find(x => x.id === d.id), p = pan(o.pid);
    try { const r = await one(p, { action: "cancel", orders: o.oid }); const x = Array.isArray(r) ? r[0] : r; const e = x && (x.error || (x.cancel && x.cancel.error)); if (e) throw new Error(e); toast("ক্যান্সেল অনুরোধ গেছে"); poll(); } catch (e) { toast(e.message); }
  },
  del: d => { if (confirm("লিস্ট থেকে মুছবেন? (প্যানেলের অর্ডার থাকবে)")) { D.orders = D.orders.filter(x => x.id !== d.id); D.tests = D.tests.filter(t => t.oid !== d.id); saveD(); render(); } },
  qtest(d) {
    if (D.tests.some(t => t.oid === d.id)) { UI.tab = "qual"; return render(); }
    const n = prompt("অর্ডারের আগে ওই আইডিতে মোট ফলোয়ার কত ছিল?"); if (n === null || isNaN(+n) || n === "") return;
    D.tests.push({ id: uid(), oid: d.id, before: +n, cps: [] }); saveD(); UI.tab = "qual"; render();
  },
  addcp(d) { const v = $("#cp" + d.id).value; if (v === "" || isNaN(+v)) return toast("সংখ্যা দিন"); D.tests.find(t => t.id === d.id).cps.push({ t: Date.now(), n: +v }); saveD(); render(); },
  deltest: d => { D.tests = D.tests.filter(t => t.id !== d.id); saveD(); render(); },
  async bal(d) {
    const p = pan(d.id), el = $("#bal" + d.id); el.textContent = "…";
    try { await syncSet(); const r = await one(p, { action: "balance" }); el.textContent = r.balance != null ? r.balance + " " + (r.currency || "") : (r.error || "ত্রুটি"); } catch (e) { el.textContent = e.message; }
  },
  async saveset() { await syncSet(); toast("সেভ হয়েছে"); },
  export() { const b = new Blob([JSON.stringify(D)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "smm-backup.json"; a.click(); },
  lock: () => location.reload()
};
async function syncSet() {
  if ($("#cx")) { S.cfg.proxy = $("#cx").value.trim(); S.cfg.pw = $("#cw").value; }
  $$("[data-f]").forEach(i => { const p = pan(i.dataset.id); if (p) p[i.dataset.f] = i.value.trim(); });
  await seal();
}

/* ---------- শুরু ---------- */
function gate() {
  const has = !!localStorage.smm_vault;
  $("#v").innerHTML = `<div class="lock card"><div class="t">${has ? "আনলক করুন" : "প্রথমবার সেটআপ"}</div><div class="mut">${has ? "" : "একটি পাসফ্রেজ দিন। এটি দিয়ে সব API Key এই ডিভাইসে এনক্রিপ্ট হয়ে থাকবে। ভুলে গেলে রিসেট করতে হবে।"}</div>
  <label>পাসফ্রেজ</label><input id="pp" type="password" autocomplete="current-password"><div class="acts"><button class="p" id="go">${has ? "আনলক" : "শুরু করুন"}</button></div><div id="pe" class="bad mut"></div></div>`;
  const go = async () => {
    const pass = $("#pp").value; if (pass.length < 4) return $("#pe").textContent = "কমপক্ষে ৪ অক্ষর";
    try {
      if (has) await unseal(pass);
      else { S.pass = pass; S.panels = HOSTS.map((h, i) => ({ id: "p" + i, name: h, api: "https://" + h + "/api/v2", key: "", main: h === "growfollows.com" })); await seal(); UI.tab = "set"; }
      try { D = Object.assign(D, JSON.parse(localStorage.smm_data || "{}")); } catch (e) {}
      $("#nav").hidden = false; $("#rf").hidden = false; render(); if (has) poll();
      setInterval(() => { if (!document.hidden && UI.tab === "track") poll(); }, 60000);
    } catch (e) { $("#pe").textContent = "পাসফ্রেজ ভুল"; }
  };
  $("#go").onclick = go; $("#pp").onkeydown = e => { if (e.key === "Enter") go(); };
}
document.addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (b && A[b.dataset.a] && b.tagName !== "SELECT") A[b.dataset.a](b.dataset); const n = e.target.closest("#nav button"); if (n) { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); UI.tab = n.dataset.t; render(); } });
document.addEventListener("change", e => { const t = e.target; if (t.tagName === "SELECT" && t.dataset.a && A[t.dataset.a]) A[t.dataset.a](t.dataset); });
document.addEventListener("input", e => { if (e.target.id === "sq") { UI.q = e.target.value; render(); } });
$("#rf").onclick = () => poll(true);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (typeof module !== "undefined") module.exports = { metrics, qscore, grade, fh, fr, D, isFinal };
else gate();
