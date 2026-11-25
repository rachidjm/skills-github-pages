# Sniper Lab — instrucciones para Claude Code

Bot de **paper trading** (simulado, sin dinero real) de memecoins de Solana. Habla con Rachid en español, directo y sin relleno.
En vivo: https://superb-caramel-d31fc2.netlify.app (Netlify publica solo la rama `sniper-lab` al hacer push).

## Reglas que no se rompen
- Solo papel: nada de wallets, claves privadas ni compras reales. Si algún día se plantea dinero real, se para y se pregunta a Rachid.
- Ninguna clave en el código. Las claves viven en variables de entorno de Netlify (`X_BEARER_TOKEN`, `ANTHROPIC_API_KEY`) y solo las usan las funciones de `netlify/functions/`.
- No cambiar las claves de `localStorage` (`snlab_arena_v1`, `snlab_portfolio_v1`, `snlab_session_v1`, `snlab_wallets_v1`, `snlab_samples_v1`, `snlab_tg_v1`, `snlab_tg_auth`) ni el formato de sus datos sin migración: ahí está todo lo aprendido.
- No tocar los ids de estrategias existentes (`data.stats` va por id). Las nuevas se añaden, no se renombran.
- Nada de mirar el futuro: un filtro solo puede usar datos disponibles en el momento de entrar.
- Los arreglos se prueban como estrategias NUEVAS en el torneo; nunca se "mejora" una estrategia cambiando la existente.

## Estructura
- `sniper-lab/index.html` — todo el bot (HTML + CSS + un `<script>`). Secciones marcadas con `// ===================== … =====================`:
  configuración (`CFG`), estrategias (`ENTRIES`, `FILTERS`, `INST_FILTERS`, `SW_SIGS`, `SW_FILTERS`, `STRATS`), estrategias inventadas (`addGen`, `specOf`, `genId`),
  sesión, fuentes (PumpPortal, RPC de Solana, X, traders top, monedas con volumen, analista IA), `evaluate`, `tryEntries`, `settle`, `record`,
  minería de patrones, descarte e innovación (`pickChampion`, `innovate`, `registerGen`), cartera (`pf…`), interfaz (`render…`).
- `sniper-lab/tg.js` — módulo de Telegram (GramJS en el navegador, ranking de comunidades, sugerencias).
- `sniper-lab/vendor/gramjs.js` — librería empaquetada, no editar a mano.
- `netlify/functions/x.mjs` y `ai.mjs` — intermediarios con tope diario. `netlify.toml` — redirecciones `/api/x` y `/api/ai`.

## Cómo comprobar antes de subir
1. Sintaxis: `node -e "const s=require('fs').readFileSync('sniper-lab/index.html','utf8'); new Function(s.split('<script>')[1].split('</script>')[0]); console.log('ok')"` y `node --check sniper-lab/tg.js`.
2. Si hay Graphify: `graphify update .` y consulta el grafo (`graphify query`, `graphify explain`) antes de tocar funciones compartidas.
3. Commit pequeño y claro en español, `git push origin sniper-lab`. Netlify publica en ~1 min.

## Ciclo de optimización (lo que te pide Rachid)
1. Lee el último `datos/sniper-lab-datos-*.json` (Rachid lo descarga con el botón "Descargar datos del bot" al pie de la web y lo guarda en `datos/`).
2. Diagnostica con cifras: qué estrategias ganan/pierden y por qué (`strategies[].reasons`, `trades[]` con `mfe`/`mae` = mejor y peor múltiplo durante la operación, `patterns`, `ideas`, `ai.runs`, `telegram.ranking`, `topWallets`).
3. Propón como máximo 3 cambios de alto impacto y aplícalos en el código: nuevas señales, filtros, tipos de salida, fuentes de datos gratuitas, o arreglos de errores. Cada cambio debe poder medirse en el torneo.
4. Comprueba, sube y escribe en `datos/CAMBIOS.md` qué cambiaste, por qué (con la cifra que lo justifica) y qué esperas ver en el siguiente export.
5. En el siguiente ciclo, revisa primero si lo anterior funcionó (compáralo con lo que escribiste) y descarta o refuerza.

`datos/` está en `.gitignore` salvo `CAMBIOS.md`: los exports no se suben a GitHub.
