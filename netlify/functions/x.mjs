// Intermediario de la API de X para Sniper Lab.
// La clave va en la variable de entorno X_BEARER_TOKEN de Netlify (nunca en el código ni en la página).
// Modos:  /api/x?mode=trend            → posts recientes sobre memecoins/Pump.fun (para detectar tendencias)
//         /api/x?mode=token&sym=XXX&mint=... → menciones de un token concreto
// Protecciones: caché (no repite búsquedas), tope diario de posts leídos (X_DAILY_POSTS) y solo estas dos búsquedas.
const cache = new Map();
let day = '', used = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    ...(process.env.ALLOW_ORIGIN ? { 'access-control-allow-origin': process.env.ALLOW_ORIGIN } : {}) },
});

export default async (req) => {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return json({ error: 'Falta la variable X_BEARER_TOKEN en Netlify' }, 500);
  const url = new URL(req.url), mode = url.searchParams.get('mode');
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; used = 0; }
  const cap = clamp(Number(process.env.X_DAILY_POSTS || 300), 10, 100000);

  let query, max, ttl, withUsers = false;
  if (mode === 'trend') {
    query = process.env.X_TREND_QUERY || '(pump.fun OR pumpfun OR memecoin OR "solana meme") -is:retweet -is:reply';
    max = clamp(Number(process.env.X_TREND_MAX || 20), 10, 100);
    ttl = 10 * 60e3;
  } else if (mode === 'token') {
    const sym = (url.searchParams.get('sym') || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
    const mint = (url.searchParams.get('mint') || '').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '').slice(0, 44);
    if (!sym && !mint) return json({ error: 'Falta sym o mint' }, 400);
    query = '(' + [sym && sym.length >= 2 ? `"$${sym}"` : '', mint ? `"${mint}"` : ''].filter(Boolean).join(' OR ') + ') -is:retweet';
    max = 10; ttl = 30 * 60e3; withUsers = true;
  } else {
    return json({ error: 'mode debe ser trend o token' }, 400);
  }

  const key = mode + '|' + query, hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return json({ ...hit.d, cached: true, used, cap });
  if (used + max > cap) return json({ error: 'Tope diario de posts alcanzado', used, cap }, 429);

  const qs = new URLSearchParams({ query, max_results: String(max), 'tweet.fields': 'created_at,public_metrics' });
  if (withUsers) { qs.set('expansions', 'author_id'); qs.set('user.fields', 'public_metrics'); }
  const r = await fetch('https://api.x.com/2/tweets/search/recent?' + qs, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: d.title || d.detail || 'Error de X', status: r.status }, r.status === 429 ? 429 : 502);
  used += (d.data || []).length;
  const followers = new Map((d.includes?.users || []).map(u => [u.id, u.public_metrics?.followers_count || 0]));
  const out = { posts: (d.data || []).map(p => ({ text: p.text, at: p.created_at, likes: p.public_metrics?.like_count || 0,
    rts: p.public_metrics?.retweet_count || 0, followers: followers.get(p.author_id) ?? null })) };
  cache.set(key, { t: Date.now(), d: out });
  return json({ ...out, used, cap });
};
