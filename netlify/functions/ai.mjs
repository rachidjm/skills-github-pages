// Analista IA de Sniper Lab: recibe un resumen de las operaciones y devuelve DÓNDE y POR QUÉ fallan,
// con un arreglo concreto de una lista cerrada. No decide ni opera: el ciclo del bot crea la variante y el torneo la valida.
// La clave va en la variable de entorno ANTHROPIC_API_KEY de Netlify (nunca en el código ni en la página).
// Opcionales: AI_MODEL (por defecto claude-haiku-5-5, el más barato) y AI_DAILY_CALLS (tope diario, por defecto 30).
let day = '', used = 0;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const SYSTEM = `Eres el analista de un laboratorio de trading SIMULADO de memecoins de Solana (Pump.fun y monedas con volumen en DEX).
Tu único trabajo: mirar los datos y explicar dónde y por qué fallan las operaciones, y proponer un arreglo por problema.
No inventes datos: cada problema debe citar cifras del resumen. Sé concreto y breve. Escribe en español de España.
Arreglos permitidos (campo "arreglo"), siempre sobre una estrategia existente (campo "estrategia" = su id exacto):
- {"tipo":"sl","valor":número 3–70}            stop loss en %
- {"tipo":"tp","valor":número 1.03–10}         objetivo como multiplicador (1.12 = +12%)
- {"tipo":"hold","valor":minutos 5–120}        salida por tiempo
- {"tipo":"trail","valor":número 3–50}         stop dinámico: vende si cae ese % desde el máximo alcanzado (se activa tras +10%)
- {"tipo":"entry","valor":"info"|"confirm"|"late8"|"late15"}   cuándo entrar (solo estrategias de monedas nuevas, no "sw_…")
- {"tipo":"up","valor":número 1.1–3}           subida previa exigida en entradas tardías
- {"tipo":"add_filter","valor":id de filtro de la lista "filtros"}
- {"tipo":"remove_filter","valor":id de filtro que tenga la estrategia}
Responde SOLO con JSON válido, sin texto alrededor, con esta forma:
{"resumen":"2-3 frases con la causa principal de las pérdidas","diagnostico":[{"problema":"…","evidencia":"cifras del resumen","estrategia":"id","arreglo":{"tipo":"…","valor":…}}]}
Máximo 5 elementos en "diagnostico", ordenados por impacto.`;

export default async (req) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'Falta la variable ANTHROPIC_API_KEY en Netlify' }, 500);
  if (req.method !== 'POST') return json({ error: 'usa POST' }, 405);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; used = 0; }
  const cap = Math.max(1, Math.min(500, Number(process.env.AI_DAILY_CALLS || 30)));
  if (used >= cap) return json({ error: 'Tope diario de análisis alcanzado', used, cap }, 429);
  const body = await req.text();
  if (body.length > 40000) return json({ error: 'resumen demasiado grande' }, 413);
  let summary; try { summary = JSON.parse(body); } catch { return json({ error: 'resumen no válido' }, 400); }
  used++;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 1500, system: SYSTEM,
      messages: [{ role: 'user', content: 'Resumen del laboratorio (JSON):\n' + JSON.stringify(summary) }] }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
  if (!r.ok) return json({ error: `API de IA ${r.status}: ${(await r.text()).slice(0, 200)}`, used, cap }, 502);
  const d = await r.json();
  const text = (d.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  let out; try { out = JSON.parse(m ? m[0] : text); } catch { return json({ error: 'la IA no devolvió JSON válido', raw: text.slice(0, 300), used, cap }, 502); }
  return json({ ...out, used, cap, model: d.model });
};
