// Sniper Lab · módulo de Telegram
// Lee los canales y grupos de llamadas en los que está la cuenta, detecta direcciones de monedas de Solana,
// puntúa cada llamada con velas reales de 1 minuto (GeckoTerminal) como si la hubieras seguido,
// y hace un ranking de comunidades. La sesión se guarda solo en este navegador.
(() => {
  const $ = id => document.getElementById(id);
  const S = () => window.__snlab || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const log = (c, t) => { try { S().log?.(c, t); } catch {} };
  const KEY = 'snlab_tg_v1', AUTH = 'snlab_tg_auth';
  // Cómo se puntúa una llamada: entras al minuto siguiente de verla, objetivo 2x, stop -40%, salida a los 60 min
  const SIM = { delayMin: 1, tp: 2, sl: 40, holdMin: 60, minN: 5 };
  const SKIP = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY9NL8UdbTXkvVb1', '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', '11111111111111111111111111111111']);

  // ---------- estado persistente ----------
  let st = { calls: [], chats: {}, last: {}, backfilled: false, sugg: {} };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.calls) st = { ...st, ...s }; } catch {}
  st.sugg ??= {};
  const save = () => { try { st.calls = st.calls.filter(c => Date.now() - c.at < 7 * 864e5).slice(-4000); localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  setInterval(save, 15000);
  let auth = {}; try { auth = JSON.parse(localStorage.getItem(AUTH)) || {}; } catch {}
  const saveAuth = () => { try { localStorage.setItem(AUTH, JSON.stringify(auth)); } catch {} };
  const seen = new Set(st.calls.map(c => c.chat + ':' + c.mint));

  // ---------- direcciones de Solana en un mensaje ----------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58len(s) { let bytes = [0]; for (const ch of s) { let c = B58.indexOf(ch); if (c < 0) return -1; for (let i = 0; i < bytes.length; i++) { c += bytes[i] * 58; bytes[i] = c & 255; c >>= 8; } while (c) { bytes.push(c & 255); c >>= 8; } } let z = 0; for (const ch of s) { if (ch === '1') z++; else break; } let n = bytes.length; while (n > 1 && bytes[n - 1] === 0) n--; return n + z - (bytes.length === 1 && bytes[0] === 0 ? 1 : 0); }
  function extract(msg) {
    let text = msg.message || msg.text || '';
    for (const e of msg.entities || []) if (e.url) text += ' ' + e.url;
    const out = new Set();
    for (const m of text.matchAll(/(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g)) { const a = m[0]; if (!SKIP.has(a) && b58len(a) === 32) out.add(a); }
    return [...out].slice(0, 3);
  }

  // ---------- precios: DexScreener (pares) y GeckoTerminal (velas) ----------
  const pairCache = new Map();
  async function pairsFor(mints) {
    const need = mints.filter(m => !pairCache.has(m));
    for (let i = 0; i < need.length; i += 30) {
      const chunk = need.slice(i, i + 30);
      try { const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + chunk.join(',')); const d = r.ok ? await r.json() : [];
        for (const m of chunk) pairCache.set(m, []);
        for (const p of Array.isArray(d) ? d : []) { const m = p.baseToken?.address; if (pairCache.has(m)) pairCache.get(m).push(p); }
      } catch { for (const m of chunk) pairCache.delete(m); }
      await sleep(250);
    }
    return mints.map(m => pairCache.get(m) || null);
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let geckoNext = 0;
  async function candles(pool, beforeTs) {
    const wait = geckoNext - Date.now(); geckoNext = Math.max(Date.now(), geckoNext) + 2200; if (wait > 0) await sleep(wait);
    for (let k = 0; k < 3; k++) {
      const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=80&before_timestamp=${beforeTs}`).catch(() => null);
      if (r?.status === 429) { await sleep(15000); continue; }
      if (!r?.ok) return [];
      const d = await r.json().catch(() => null); return d?.data?.attributes?.ohlcv_list || [];
    }
    return [];
  }

  // ---------- puntuar una llamada como si la hubieras seguido ----------
  function netPct(raw) { const cfg = S().cfg || { feePct: 1.75, slipPct: 1, netFeeSol: 0.0002 }, c = (cfg.feePct + cfg.slipPct) / 100, fix = cfg.netFeeSol * (S().solEur?.() || 130); return (((1 - fix) / (1 + c)) * raw * (1 - c) - fix - 1) * 100; }
  async function resolve(call) {
    const [pairs] = await pairsFor([call.mint]);
    if (pairs === null) return false;                                   // fallo de red: reintentar luego
    const at = Math.floor(call.at / 1000);
    const use = pairs.filter(p => !p.pairCreatedAt || p.pairCreatedAt / 1000 <= at + SIM.holdMin * 60).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)).slice(0, 2);
    if (!use.length) { call.status = 'nada'; return true; }             // no es una moneda con mercado (wallet, NFT…)
    const p0 = use[0]; call.sym ??= p0.baseToken?.symbol; call.dex = p0.dexId;
    const supply = p0.fdv && +p0.priceUsd ? p0.fdv / +p0.priceUsd : 1e9;
    if (p0.pairCreatedAt) call.ageMin = Math.max(0, Math.round((call.at - p0.pairCreatedAt) / 60000));
    const byTs = new Map();
    for (const p of use) for (const [ts, o, h, l, c, v] of await candles(p.pairAddress, at + (SIM.holdMin + 2) * 60)) {
      const e = byTs.get(ts); if (!e) byTs.set(ts, { ts, o, h, l, c, v }); else { e.h = Math.max(e.h, h); e.l = Math.min(e.l, l); if (v > e.v) { e.o = o; e.c = c; e.v = v; } }
    }
    const cs = [...byTs.values()].sort((a, b) => a.ts - b.ts);
    const start = Math.floor(at / 60) * 60 + SIM.delayMin * 60, end = start + SIM.holdMin * 60;
    const before = cs.filter(x => x.ts < start).at(-1), after = cs.filter(x => x.ts >= start && x.ts < end);
    const entry = after.length && after[0].ts - start <= 300 ? after[0].o : before?.c;
    if (!entry) { call.status = 'nada'; return true; }
    call.mcap0 = entry * supply;
    let raw = null, reason = 'tiempo', peak = 1;
    for (const x of after) {
      if (x.l <= entry * (1 - SIM.sl / 100)) { raw = 1 - SIM.sl / 100; reason = 'stop'; break; }     // si el mismo minuto toca stop y objetivo, contamos el stop
      peak = Math.max(peak, x.h / entry);
      if (x.h >= entry * SIM.tp) { raw = SIM.tp; reason = 'objetivo'; break; }
    }
    if (raw === null) raw = after.length ? after.at(-1).c / entry : 1;
    for (const x of after) peak = Math.max(peak, x.h / entry);
    call.raw = raw; call.peak = +peak.toFixed(2); call.reason = after.length ? reason : 'sin actividad'; call.net = +netPct(raw).toFixed(2); call.status = 'ok';
    return true;
  }
  let resolving = false;
  async function resolveLoop() {
    if (resolving) return; resolving = true;
    try {
      const due = st.calls.filter(c => !c.status && Date.now() - c.at > (SIM.delayMin + SIM.holdMin + 2) * 60e3).sort((a, b) => b.at - a.at).slice(0, 40);
      await pairsFor([...new Set(due.map(c => c.mint))]);
      for (const c of due) { try { const ok = await resolve(c); if (ok && c.status === 'ok') { const ch = st.chats[c.chat]?.title || c.chat; log(c.net > 0 ? 'g' : 'r', `TG · ${esc(ch)} · $${esc(c.sym || c.mint.slice(0, 4))} → ${c.net > 0 ? '+' : ''}${c.net.toFixed(1)}% (${c.reason}, máx ${c.peak}x)`); } } catch {} }
      if (due.length) save();
    } finally { resolving = false; }
  }
  setInterval(resolveLoop, 60e3); setTimeout(resolveLoop, 4000);

  // ---------- registrar una llamada ----------
  function addCall(chatId, title, msg, live) {
    const at = (msg.date || Math.floor(Date.now() / 1000)) * 1000;
    for (const mint of extract(msg)) {
      const k = chatId + ':' + mint; if (seen.has(k)) continue; seen.add(k);
      const others = st.calls.filter(c => c.mint === mint);
      const call = { chat: chatId, mint, at, msg: msg.id, first: !others.length || others.every(c => c.at > at) };
      st.calls.push(call);
      const t = S().tokens?.get?.(mint);
      if (t) { t.tgCalls = (t.tgCalls || 0) + 1; if (t.f) t.f.tgCalls = t.tgCalls; }
      if (live) log('c', `TG · ${esc(title)} llama ${t ? '$' + esc(t.symbol) : mint.slice(0, 4) + '…' + mint.slice(-4)}${t ? ' (el bot ya la seguía)' : ''}`);
      if (live && Date.now() - at < 5 * 60e3) { const r = ranking().find(x => x.id === chatId); S().onCall?.(mint, { src: 'Telegram', chat: title, first: call.first, top: !!(r && r.n >= SIM.minN && r.lb > 0) }); }
    }
  }

  // ---------- conexión con Telegram (GramJS en el navegador) ----------
  let client = null, me = null, status = 'off', err = '', asking = null, dialogs = [], polling = false, backfill = { done: 0, total: 0, on: false };
  function loadLib() { return window.GramJS ? Promise.resolve() : new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'vendor/gramjs.js'; s.onload = ok; s.onerror = () => ko(new Error('no se pudo cargar la librería de Telegram')); document.head.appendChild(s); }); }
  function ask(kind) { return new Promise(res => { asking = { kind, res }; ui(); setTimeout(() => $('tgAskIn')?.focus(), 50); }); }
  async function connect(fromSaved) {
    if (client || status === 'connecting') return;
    status = 'connecting'; err = ''; ui();
    try {
      await loadLib();
      const { TelegramClient, StringSession } = window.GramJS;
      client = new TelegramClient(new StringSession(auth.session || ''), Number(auth.apiId), auth.apiHash, { connectionRetries: 5, useWSS: true });
      try { client.setLogLevel('none'); } catch {}
      if (fromSaved) { await client.connect(); if (!(await client.checkAuthorization())) throw new Error('la sesión guardada ya no vale: vuelve a iniciar sesión'); }
      else await client.start({ phoneNumber: async () => auth.phone, phoneCode: async () => ask('code'), password: async () => ask('pass'), onError: e => { err = e.message; ui(); } });
      auth.session = client.session.save(); delete auth.phone; saveAuth();
      me = await client.getMe(); status = 'on'; asking = null;
      log('g', `TG · conectado como ${esc(me.username ? '@' + me.username : me.firstName || 'cuenta')}`);
      const { NewMessage } = window.GramJS;
      client.addEventHandler(ev => { const m = ev.message; if (!m || ev.isPrivate) return; const id = String(m.chatId); onMsg(id, m, true); }, new NewMessage({}));
      await refreshDialogs(); if (!st.backfilled || !st.hist2) runBackfill();
      setInterval(pollDialogs, 120e3); setInterval(resolveSugg, 5 * 60e3); setTimeout(resolveSugg, 30e3);
    } catch (e) { err = e.message || String(e); status = 'off'; asking = null; try { await client?.disconnect(); } catch {} client = null; if (/AUTH_KEY|SESSION|ya no vale/i.test(err)) { delete auth.session; saveAuth(); } }
    ui();
  }
  function onMsg(chatId, m, live) {
    if (!st.chats[chatId]) { const d = dialogs.find(x => x.id === chatId); st.chats[chatId] = { title: d?.title || chatId }; }
    st.last[chatId] = Math.max(st.last[chatId] || 0, m.id);
    addCall(chatId, st.chats[chatId].title, m, live);
    suggest(chatId, m);
  }
  // Canales que tus comunidades reenvían o enlazan (y en los que aún no estás)
  function suggest(chatId, m) {
    const add = (key, info) => { const e = st.sugg[key] || (st.sugg[key] = { n: 0, from: [], ...info }); e.n++; e.last = Date.now(); if (!e.from.includes(chatId) && e.from.length < 20) e.from.push(chatId); if (info.title && !e.title) e.title = info.title; };
    const fw = m.fwdFrom, cid = fw?.fromId?.channelId;
    if (cid) { const id = '-100' + String(cid); if (id !== chatId) add('c' + cid, { cid: String(cid), title: fw.fromName || null }); }
    let text = m.message || ''; for (const e of m.entities || []) if (e.url) text += ' ' + e.url;
    for (const x of text.matchAll(/t\.me\/(\+[A-Za-z0-9_-]{8,}|joinchat\/[A-Za-z0-9_-]{8,}|[A-Za-z][A-Za-z0-9_]{4,31})(?![A-Za-z0-9_])/g)) {
      const h = x[1]; if (/^(s|c|share|addstickers|proxy|socks|iv|bot)$/i.test(h) || /bot$/i.test(h)) continue;
      add('u' + h.toLowerCase(), { user: h.startsWith('+') || h.startsWith('joinchat') ? null : h, link: 'https://t.me/' + h });
    }
  }
  let resolvingSugg = false;
  async function resolveSugg() {
    if (!client || resolvingSugg) return; resolvingSugg = true;
    try {
      const todo = Object.entries(st.sugg).filter(([k, e]) => k[0] === 'c' && !e.link && !e.fail).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
      for (const [, e] of todo) { try { const ent = await client.getEntity(Number('-100' + e.cid)); e.title = ent.title || e.title; if (ent.username) { e.user = ent.username; e.link = 'https://t.me/' + ent.username; } else e.fail = true; } catch { e.fail = true; } await sleep(1500); }
    } finally { resolvingSugg = false; }
  }
  async function refreshDialogs() {
    const ds = await client.getDialogs({ limit: 300 });
    dialogs = ds.filter(d => d.isChannel || d.isGroup).map(d => ({ id: String(d.id), title: d.title || d.name || String(d.id), entity: d.entity, top: d.message?.id || 0 }));
    for (const d of dialogs) st.chats[d.id] = { title: d.title };
  }
  async function pollDialogs() {
    if (!client || polling) return; polling = true;
    try { await refreshDialogs();
      for (const d of dialogs) { const last = st.last[d.id] || 0; if (!last) { await readHistory(d); log('c', `TG · nueva comunidad: ${esc(d.title)} · leídas sus últimas 24 h`); continue; } if (d.top <= last) continue;
        const ms = await client.getMessages(d.entity, { minId: last, limit: 30 }).catch(() => []); for (const m of [...ms].reverse()) onMsg(d.id, m, true); await sleep(400); }
    } catch {} finally { polling = false; }
  }
  async function readHistory(d) {
    const since = Date.now() / 1000 - 24 * 3600;
    try { const ms = await client.getMessages(d.entity, { limit: 60 }); for (const m of [...ms].reverse()) if (m.date >= since) onMsg(d.id, m, false); } catch {}
    st.last[d.id] = Math.max(st.last[d.id] || 0, d.top || 1); await sleep(500);
  }
  async function runBackfill() {
    backfill = { done: 0, total: dialogs.length, on: true }; ui();
    const since = Date.now() / 1000 - 24 * 3600;
    for (const d of dialogs) {
      try { const ms = await client.getMessages(d.entity, { limit: 60 }); for (const m of [...ms].reverse()) if (m.date >= since) onMsg(d.id, m, false); st.last[d.id] = Math.max(st.last[d.id] || 0, d.top); } catch {}
      backfill.done++; await sleep(500);
    }
    backfill.on = false; st.backfilled = true; st.hist2 = true; save();
    log('c', `TG · historial de 24 h leído: ${st.calls.length} llamadas en ${dialogs.length} comunidades · puntuándolas con velas reales`);
    resolveLoop();
  }
  async function logout() {
    try { await client?.invoke(new window.GramJS.Api.auth.LogOut()); } catch {}
    try { await client?.disconnect(); } catch {}
    client = null; me = null; status = 'off'; auth = {}; saveAuth(); ui();
  }

  // ---------- ranking ----------
  function stats(list) {
    const ok = list.filter(c => c.status === 'ok'), n = ok.length;
    if (!n) return { calls: list.length, n: 0 };
    const nets = ok.map(c => c.net), mean = nets.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(nets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
    const mc = ok.map(c => c.mcap0 || 0).sort((a, b) => a - b);
    return { calls: list.length, n, wr: 100 * ok.filter(c => c.net > 0).length / n, mean, lb: mean - sd / Math.sqrt(n), x2: 100 * ok.filter(c => c.peak >= 2).length / n, mcap: mc[Math.floor(n / 2)], first: 100 * ok.filter(c => c.first).length / n };
  }
  function ranking() {
    const by = new Map(); for (const c of st.calls) { if (c.status === 'nada') continue; if (!by.has(c.chat)) by.set(c.chat, []); by.get(c.chat).push(c); }
    return [...by.entries()].map(([id, l]) => ({ id, title: st.chats[id]?.title || id, ...stats(l) })).sort((a, b) => (b.n >= SIM.minN) - (a.n >= SIM.minN) || (b.lb ?? -1e9) - (a.lb ?? -1e9) || b.calls - a.calls);
  }
  window.__tg = { st, ranking, stats, resolveLoop, status: () => status };

  // ---------- interfaz ----------
  const pc = v => v == null || isNaN(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  const usd = v => !v ? '–' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + Math.round(v);
  const col = v => v > 0 ? 'var(--g)' : 'var(--r)';
  const when = ts => new Date(ts).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
  function ui() {
    if (!$('tgRow')) return;
    const on = status === 'on';
    $('tgForm').hidden = on || !!asking || status === 'connecting';
    $('tgAsk').hidden = !asking;
    $('tgOn').hidden = !on;
    if (asking) { $('tgAskLbl').firstChild.textContent = asking.kind === 'code' ? 'CÓDIGO QUE TE HA LLEGADO A TELEGRAM' : 'CONTRASEÑA DE VERIFICACIÓN EN DOS PASOS'; $('tgAskIn').type = asking.kind === 'pass' ? 'password' : 'text'; }
    $('tgBadge').textContent = on ? 'conectado' : status === 'connecting' ? (asking ? 'esperando tu código' : 'conectando…') : 'sin conectar';
    if (on) $('tgWho').textContent = `${me?.username ? '@' + me.username : me?.firstName || 'cuenta'} · ${dialogs.length} comunidades vigiladas${backfill.on ? ` · leyendo historial ${backfill.done}/${backfill.total}` : ''}`;
    $('tgErr').textContent = err ? 'Error: ' + err : '';
    const chip = $('tgChip'); if (chip) { chip.textContent = on ? `Telegram · activo · ${dialogs.length} comunidades` : 'Telegram · sin conectar'; chip.className = on ? 'on' : ''; }
    const all = stats(st.calls.filter(c => c.status !== 'nada')), pend = st.calls.filter(c => !c.status).length;
    $('tgK1').textContent = st.calls.filter(c => c.status !== 'nada').length; $('tgK2').textContent = all.n || 0;
    $('tgK3').textContent = all.n ? Math.round(all.wr) + '%' : '–'; $('tgK3').style.color = all.n ? col(all.mean) : '';
    $('tgK4').textContent = all.n ? pc(all.mean) : '–'; $('tgK4').style.color = all.n ? col(all.mean) : '';
    $('tgNote').textContent = all.n ? `Si hubieras seguido todas las llamadas (entrando 1 min después, objetivo 2x, stop −40%, máx. 60 min, con comisiones): ${Math.round(all.wr)}% de acierto y ${pc(all.mean)} de media por operación. ${Math.round(all.x2)}% llegaron a 2x en algún momento.${pend ? ` ${pend} llamadas esperando a cumplir 1 h para puntuarlas.` : ''}` : pend ? `${pend} llamadas detectadas; cada una se puntúa cuando cumple 1 h.` : 'Cuando conectes, el bot lee las últimas 24 h de cada comunidad y puntúa sus llamadas con precios reales.';
    const rk = ranking();
    $('tgRankTxt').textContent = rk.length ? `${rk.length} comunidades · fiable desde ${SIM.minN} llamadas` : 'sin datos';
    $('tgRank').innerHTML = rk.length ? rk.slice(0, 60).map((r, i) => `<tr${r.n >= SIM.minN && r.lb > 0 ? ' class="ch"' : ''}><td>${r.n >= SIM.minN ? i + 1 : '·'}</td><td>${esc(r.title)}</td><td>${r.calls}${r.n < r.calls ? ` <span style="color:var(--dim)">(${r.n})</span>` : ''}</td><td>${r.n ? Math.round(r.wr) + '%' : '–'}</td><td style="color:${r.n ? col(r.mean) : ''}">${r.n ? pc(r.mean) : '–'}</td><td>${r.n ? Math.round(r.x2) + '%' : '–'}</td><td>${r.n ? Math.round(r.first) + '%' : '–'}</td><td>${r.n ? usd(r.mcap) : '–'}</td><td style="color:${r.n >= SIM.minN ? col(r.lb) : 'var(--dim)'}">${r.n >= SIM.minN ? pc(r.lb) : 'faltan datos'}</td></tr>`).join('') : '<tr><td colspan="9" style="color:var(--soft)">Sin llamadas todavía.</td></tr>';
    const mine = new Set(dialogs.map(d => d.id)), myUsers = new Set(dialogs.map(d => (d.entity?.username || '').toLowerCase()).filter(Boolean));
    const sg = Object.entries(st.sugg).map(([k, e]) => ({ k, ...e })).filter(e => !(e.cid && mine.has('-100' + e.cid)) && !(e.user && myUsers.has(e.user.toLowerCase())) && (e.link || e.title)).sort((a, b) => b.from.length - a.from.length || b.n - a.n).slice(0, 30);
    if ($('sgList')) { $('sgTxt').textContent = sg.length ? `${sg.length} canales · ordenados por cuántas de tus comunidades los mencionan` : 'desde tus grupos';
      if (sg.length) $('sgList').innerHTML = sg.map(e => `<div class="tt"><span class="s" style="color:var(--c)">${e.from.length} grupo${e.from.length > 1 ? 's' : ''}</span><span><b>${esc(e.title || (e.user ? '@' + e.user : 'invitación privada'))}</b>${e.user && e.title ? ` · @${esc(e.user)}` : ''}</span><span class="n" style="color:var(--soft)">${e.n}×</span><span class="w">${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener" style="color:var(--c)">${esc(e.link)}</a>` : 'canal privado o sin enlace público'}</span></div>`).join(''); }
    const recent = [...st.calls].filter(c => c.status !== 'nada').sort((a, b) => b.at - a.at).slice(0, 25);
    $('tgCalls').innerHTML = recent.length ? recent.map(c => `<div class="tt"><span class="s" style="color:${c.status === 'ok' ? col(c.net) : 'var(--c)'}">${c.status === 'ok' ? (c.net > 0 ? 'ACIERTO' : 'FALLO') : 'EN CURSO'}</span><span><b>${c.sym ? '$' + esc(c.sym) : esc(c.mint.slice(0, 4) + '…' + c.mint.slice(-4))}</b> · ${esc(st.chats[c.chat]?.title || c.chat)}${c.first ? ' · primera en llamarla' : ''}</span><span class="n" style="color:${c.status === 'ok' ? col(c.net) : 'var(--soft)'}">${c.status === 'ok' ? pc(c.net) : '…'}</span><span class="w">${when(c.at)}${c.status === 'ok' ? ` · ${c.reason} · máx ${c.peak}x · mcap ${usd(c.mcap0)}${c.ageMin != null ? ` · moneda con ${c.ageMin} min` : ''}` : ''} · <span style="user-select:all">${esc(c.mint)}</span></span></div>`).join('') : '<div class="sub">Sin llamadas todavía.</div>';
  }
  function bind() {
    if (!$('tgRow')) return;
    if (auth.apiId) $('tgApiId').value = auth.apiId;
    $('tgGo').onclick = () => {
      const apiId = $('tgApiId').value.trim(), apiHash = $('tgApiHash').value.trim(), phone = $('tgPhone').value.replace(/[\s-]/g, '');
      if (!/^\d+$/.test(apiId) || !/^[0-9a-f]{32}$/i.test(apiHash) || !/^\+\d{8,15}$/.test(phone)) { err = 'revisa los datos: api_id son números, api_hash son 32 caracteres y el teléfono va con prefijo (+34…)'; ui(); return; }
      auth = { apiId, apiHash, phone }; saveAuth(); $('tgApiHash').value = ''; connect(false);
    };
    const send = () => { const v = $('tgAskIn').value.trim(); if (!v || !asking) return; const a = asking; asking = null; $('tgAskIn').value = ''; err = ''; ui(); a.res(v); };
    $('tgAskOk').onclick = send; $('tgAskIn').onkeydown = e => { if (e.key === 'Enter') send(); };
    $('tgOut').onclick = logout;
    $('tgRescan').onclick = () => { if (client && !backfill.on) runBackfill(); };
    ui(); setInterval(ui, 2000);
    if (auth.session && auth.apiId && auth.apiHash) connect(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
