// Decide si vender o mantener posiciones de estrategias con "venta: decide la IA" (botón "Añadir IA" del laboratorio).
// Aparte del analista de diagnóstico (ai.mjs, cada 20 min, 30 llamadas/día): este tiene su propio tope diario
// para que uno no se coma el presupuesto del otro. No inventa ni mira datos futuros: decide solo con lo que se le pasa.
// La clave va en ANTHROPIC_API_KEY (la misma que ai.mjs). Opcionales: AI_EXIT_DAILY_CALLS (por defecto 300), AI_MODEL.
let day = '', used = 0;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const SYSTEM = `Eres el gestor de salidas de un laboratorio de trading SIMULADO (papel, sin dinero real) de memecoins de Solana.
Te paso una lista de posiciones abiertas. Para cada una decide "vender" o "mantener", usando SOLO los datos que te doy de esa posición
(nunca inventes datos ni asumas lo que pasará después). Pistas útiles: volumen e impulso que caen, liquidez que baja, o ya muy lejos del
objetivo sin romper máximos sugieren vender; movimiento sano y liquidez estable sugieren mantener. Cada decisión debe citar una cifra.
Responde SOLO con JSON válido, sin texto alrededor: {"decisiones":[{"pos":"<tal cual te la paso>","accion":"vender"|"mantener","motivo":"máx. 100 caracteres"}]}`;

export default async (req) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'Falta la variable ANTHROPIC_API_KEY en Netlify' }, 500);
  if (req.method !== 'POST') return json({ error: 'usa POST' }, 405);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; used = 0; }
  const cap = Math.max(1, Math.min(2000, Number(process.env.AI_EXIT_DAILY_CALLS || 300)));
  if (used >= cap) return json({ error: 'Tope diario de decisiones de venta alcanzado', used, cap }, 429);
  const body = await req.text();
  if (body.length > 20000) return json({ error: 'demasiadas posiciones de golpe' }, 413);
  let positions; try { positions = JSON.parse(body); } catch { return json({ error: 'datos no válidos' }, 400); }
  if (!Array.isArray(positions) || !positions.length) return json({ error: 'sin posiciones' }, 400);
  used++;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 2000, system: SYSTEM,
      messages: [{ role: 'user', content: 'Posiciones abiertas (JSON):\n' + JSON.stringify(positions) }] }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
  if (!r.ok) return json({ error: `API de IA ${r.status}: ${(await r.text()).slice(0, 200)}`, used, cap }, 502);
  const d = await r.json();
  const text = (d.content || []).map(c => c.text || '').join('');
  let out = null;
  try { out = JSON.parse(text.replace(/```(?:json)?/gi, '').trim()); } catch {}
  if (!out?.decisiones) return json({ error: 'la IA no devolvió JSON válido', raw: text.slice(0, 300), used, cap }, 502);
  return json({ ...out, used, cap, model: d.model });
};
