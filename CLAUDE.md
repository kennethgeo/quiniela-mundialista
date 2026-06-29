# Quiniela Mundialista — notas del proyecto

## Reglas de puntaje (fuente de verdad: `frontend/src/lib/scoring.js` y `backend/app/services/scoring.py` — deben quedar idénticas)

### Fase de grupos / regular
- **Marcador exacto** (goles predichos = goles reales): **3 pts**
- **Resultado correcto** (acierta ganador o empate, no el marcador): **1 pt**
- **Fallo**: 0 pts
- **Comodín x2**: duplica los puntos del marcador (exacto → 6, correcto → 2). Límite por fase/jornada según `powerup_limits`.
- **No hay default 0-0**: si no predijiste, quedás sin predicción (0). (El default 0-0 se probó y se quitó "a partir de ahora", jun 2026.)

### Eliminatoria — penales (cuando el partido empata en 90/120 y se define por penales)
Reglas vigentes (jun 2026, cambiadas a pedido del admin):
- **Predijiste empate**: el marcador del empate **puntúa igual** (3 si exacto, 1 si empate no exacto) **aunque falles el penal**. Si **aciertas quién pasa**, sumás un **bonus de +1** (el comodín x2 NO dobla el bonus).
  - 0-0 exacto + penal acertado = 4 · + fallado = 3 · + x2 = 7
  - 1-1 (no exacto) + penal acertado = 2 · + fallado = 1
- **Predijiste un ganador** (ej. 3-1) y el partido se fue a penales: **1 pt** si el equipo que elegiste es el que **avanza** en penales; si no, 0. (Con x2 → 2.)
- Predijiste un ganador y el partido se definió en 90/120 (sin penales): 3 exacto / 1 correcto, como siempre.

> Nota: el bonus de penal (+1) es fijo y NO lo dobla el comodín. El x2 solo dobla la parte del marcador.

### Predicciones globales
- Acertar **campeón**: 12 pts · Acertar **goleador**: 12 pts (`tournament_predictions`).

## Bracket de eliminatoria (Mundial 2026)
- Estructura REAL oficial FIFA (migración `database/16_real_bracket_2026.sql`). Slots de tercero con 5 grupos candidatos.
- Asignación de mejores terceros: **tabla oficial FIFA clavada** para el escenario real (grupos B,D,E,F,I,J,K,L) en `bracketResolver.js` / `bracket_resolver.py`; fallback a emparejamiento bipartito.
- Los nombres reales se **persisten en la BD** (backend `bracket_resolver.persist_resolved_knockouts`, dentro del live-sync) porque el sync empareja con ESPN por nombre.

## Despliegue
- **Vercel** despliega frontend Y backend juntos en cada push a `main` (root `vercel.json` → `experimentalServices`, backend `@vercel/python` bajo `/_backend`).
- Cron de marcadores: GitHub Actions `sync-live-scores.yml` (cada ~5 min) → `POST /_backend/api/matches/sync-live`.
- Migraciones SQL: el admin las corre a mano en el SQL Editor de Supabase (archivos en `database/`).

## Al cambiar reglas de puntaje
1. Cambiar **ambos** motores (`scoring.js` y `scoring.py`) para que coincidan.
2. Actualizar la tarjeta correspondiente en `frontend/src/pages/RulesPage.jsx`.
3. Avisar al grupo. Si hay partidos ya puntuados con la regla vieja, recalcular (`recalc-scores`).
