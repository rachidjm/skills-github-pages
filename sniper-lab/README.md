# Sniper Lab // Solana

Bot de paper trading para Pump.fun que funciona en el navegador con datos reales y sin claves:
- Tokens nuevos: PumpPortal (gratis).
- Trades, wallets y precios: nodo público de Solana (PublicNode).
- 228 estrategias compitiendo a la vez; el campeón se elige por € por operación con margen fiable.
- Vetos y puntuación de riesgo de holders (código propio).

Solo papel: no usa wallet ni compra nada. Abre `index.html` desde su enlace https (no como archivo local).

## Conectar X (tendencias)

La clave de X nunca va en la página. Se usa un intermediario en Netlify:
1. Netlify → Add new site → Import an existing project → GitHub → `skills-github-pages`, rama `sniper-lab` (la configuración sale sola de `netlify.toml`).
2. Site configuration → Environment variables: `X_BEARER_TOKEN` = tu Bearer Token de X. Opcional: `X_DAILY_POSTS` (tope de posts leídos al día, por defecto 300).
3. Abre la web `https://<tu-sitio>.netlify.app`: el bot detecta el intermediario solo.
