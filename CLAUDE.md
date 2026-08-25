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
- **Predijiste empate**: el marcador del empate **puntúa igual** (3 si exacto, 1 si empate no exacto) **aunque falles el penal**. Si **aciertas quién pasa**, sumás **+1** a la base. El **comodín x2 duplica TODO, incluido ese +1** (el +1 se suma a la base ANTES del x2).
  - 0-0 exacto + penal acertado = 4 · + fallado = 3 · + x2 = 8
  - 1-1 (no exacto) + penal acertado = 2 · + fallado = 1 · + x2 = 4
- **Predijiste un ganador** (ej. 3-1) y el partido se fue a penales: **1 pt** si el equipo que elegiste es el que **avanza** en penales; si no, 0. (Con x2 → 2.)
- Predijiste un ganador y el partido se definió en 90/120 (sin penales): 3 exacto / 1 correcto, como siempre.

> Nota: el comodín x2 duplica TODO lo que sumás en el partido, incluido el +1 por acertar la tanda.

## Penales automáticos
- El live-sync detecta solo que un partido de eliminatoria terminó empatado → lo marca como definido por penales y toma el ganador (`competitor.winner` de ESPN). Setea `goes_to_penalties` + `penalties_winner_real` y re-puntúa (idempotente, también partidos ya finalizados). El form de admin (AdminPage) es el respaldo manual.
- ¿Qué cuenta como "eliminatoria"? Un partido con `phase != 'groups'`. El `espn_tournament_sync` etiqueta `phase = 'knockout'` cuando ESPN reporta una fase (`stage_base`: semi/final/liguilla/octavos…), y `'groups'` para la fase regular de liga. **Así la postemporada de una liga (semis/final) puntúa como eliminatoria, igual que una copa.** Caveat: en series de ida y vuelta la detección es por partido, no por el global; el form de admin corrige los casos raros.

### Predicciones globales
- Acertar **campeón**: 12 pts · Acertar **goleador**: 12 pts · Acertar **asistidor**: 12 pts (`tournament_predictions`; puntos configurables por quiniela: `champion_points`/`scorer_points`/`assist_points`). El admin fija los reales en `tournaments.actual_champion/actual_top_scorer/actual_top_assist` y reparte con `calc-tournament-globals`.

## Partidos cancelados/pospuestos y arrastre del comodín ×2
- Un partido `status = 'cancelled'/'postponed'` **no cuenta para el puntaje**: `void_cancelled_match(match_id)` (SQL, `SECURITY DEFINER`, migración `database/48_powerup_carryover.sql`) anula `points_earned`, devuelve el ×2 si lo usaron, y — **decisión votada por el grupo** — le otorga a esa persona un **crédito de arrastre** (`powerup_credits`) para usar el ×2 de más en la **próxima jornada/fase cronológica del mismo torneo**, aunque ya haya gastado su cupo ahí.
- Es la ÚNICA vía para anular un partido: tanto el backend (`scoring.py`, syncs) como el frontend (`lib/scoring.js`, usado por AdminPage) llaman a esta función en vez de tocar `predictions` directo — necesario porque las políticas RLS de `predictions` solo dejan escribir al propio usuario o a `service_role`; un admin editando las predicciones de otros no podría hacerlo de otra forma.
- El trigger `check_powerup_limit()` valida contra cupo base (`leagues.powerup_limit`) **+ créditos sin consumir**; al activar por encima del cupo base consume el crédito más viejo; al desactivar el ×2, lo devuelve.
- El sync automático (`espn_tournament_sync`/`live_sync`) **no vuelve a tocar** un partido ya marcado `cancelled`/`postponed` en la BD (lo excluye del upsert), para que una corrección manual del admin no se pierda si la fuente (ESPN) sigue reportando el partido como jugado.

## Bracket de eliminatoria (Mundial 2026)
- Estructura REAL oficial FIFA (migración `database/16_real_bracket_2026.sql`). Slots de tercero con 5 grupos candidatos.
- Asignación de mejores terceros: **tabla oficial FIFA clavada** para el escenario real (grupos B,D,E,F,I,J,K,L) en `bracketResolver.js` / `bracket_resolver.py`; fallback a emparejamiento bipartito.
- Los nombres reales se **persisten en la BD** (backend `bracket_resolver.persist_resolved_knockouts`, dentro del live-sync) porque el sync empareja con ESPN por nombre.

## Administración por quiniela (migración `database/59_admins_por_quiniela.sql`)
- `leagues.admin_id` = **creador**, no se le puede quitar. `league_members.es_admin` = co-admins que nombra el creador.
- Fuente única de verdad: `es_admin_liga(league_id, user_id)` (creador OR es_admin). Toda función per-league la usa; **no volver a escribir `admin_id = auth.uid()` a mano**.
- Solo el creador: nombrar/quitar admins (`set_league_admin`), borrar la quiniela (`delete_group`). Cualquier admin: reglas, puntaje, pozo/cuota, confirmar pagos, proponer/cancelar votaciones, expulsar miembros (menos al creador y a sí mismo).
- **Un admin de quiniela NO edita resultados de partidos**: los partidos son compartidos por todas las quinielas del mismo torneo, así que eso sigue siendo del admin global (`users.is_admin`).
- Nadie confirma su propio pago, ni siquiera un admin.
- Panel: `frontend/src/components/tournament/MiembrosYAdmins.jsx`, en la pestaña Reglas junto a `PozoYPagos`.

## Jornadas y rachas (migración `database/60_jornadas_y_rachas.sql`)
- `league_jornadas(league_id)` devuelve, en un solo jsonb, la tabla de cada jornada + las rachas. **No guarda nada**: todo sale de `predictions.points_earned`, así una corrección del admin se refleja sola.
- El ganador de la jornada usa **la misma escalera de desempate que la Tabla** (migración 55). No inventar un segundo criterio acá.
- Para ganar hay que sumar: si nadie hizo puntos, la jornada queda **sin ganador**.
- Rachas y conteo de ganadas solo cuentan **jornadas cerradas** (todos sus partidos `finished`). Una jornada sin ganador corta la racha.
- UI: `frontend/src/components/tournament/JornadasYRachas.jsx`, arriba de la matriz del Histórico.

## Guardar una jornada completa de un saque
- `PredecirJornada.jsx` (modal desde el botón LLENAR del encabezado de jornada) manda **un solo upsert** con todos los partidos abiertos.
- **El orden del lote importa**: `check_powerup_limit` corre fila por fila dentro del mismo INSERT y ve las filas anteriores. Comprobado contra Postgres: `[prender B, apagar A]` revienta con "Límite de comodines x2 alcanzado" aunque el estado final respete el cupo; `[apagar A, prender B]` pasa. Por eso `lib/loteJornada.js` manda **las desactivaciones primero**. No cambiar ese orden.
- El lote es **atómico**: si el trigger rechaza algo no se guarda nada, ni los marcadores. Por eso el cupo de ×2 también se respeta en vivo en el modal.
- La tanda de penales se sigue eligiendo en la tarjeta del partido; el lote conserva la que ya hubiera.

## Seguridad de la base (migración `database/61_endurecer_permisos.sql`)
Reglas que NO se pueden volver a romper al escribir SQL nuevo:
- **Nunca usar `auth.uid() IS NULL` para decir "me llama el backend"**: una llamada anónima también da NULL. Usar `es_backend()`, que mira el claim `role` de PostgREST.
- **PostgreSQL otorga EXECUTE a `PUBLIC` al crear una función, y un `GRANT ... TO authenticated` posterior NO lo quita.** Toda función nueva nace abierta a `anon`. La migración 61 revoca en bloque y re-otorga la lista exacta; `ALTER DEFAULT PRIVILEGES` cubre las futuras, pero conviene verificarlo (el bloque final de la 61 avisa).
- Solo se otorga EXECUTE a lo que el frontend llama de verdad (sacado de los `supabase.rpc(...)`) **más** las funciones usadas dentro de políticas RLS (`is_league_member`, `tournament_predictions_open`, `es_admin_liga`): ahí se evalúan como quien consulta, y sin permiso se caen las lecturas.
- `users`: privilegios por columna (`UPDATE` solo de `display_name`/`avatar_url`, `SELECT` sin `email`) + trigger `congelar_campos_sensibles_users` por si alguien vuelve a correr un `GRANT ALL`. **`is_admin` no se toca desde el cliente.**
- Las funciones de trigger que llaman a otras funciones deben ser `SECURITY DEFINER`. `trg_recompute_user_total` era invoker y al revocar permisos **rompía el guardado de predicciones**; se detectó probando, no leyendo.
- `check_powerup_limit` toma `pg_advisory_xact_lock` por (usuario, liga, fase, jornada) antes de contar. Sin eso, dos envíos simultáneos se pasan del cupo (comprobado: cupo 1 → 2 comodines guardados).

## Ranking global (migración `database/62_ranking_global_sin_duplicados.sql`)
- `user_total_calculado(user_id)` es la **única** fórmula del total global. Antes estaba escrita dos veces (SQL y JS) y por eso una se olvidó de los puntos de asistidor durante meses.
- Cada **partido** cuenta una vez (el mejor puntaje entre tus quinielas) y cada **torneo** una vez para campeón/goleador/asistidor. Sin esto, estar en más quinielas inflaba el ranking global.
- **No cambia nada dentro de cada quiniela**: `league_points`, la Tabla, las jornadas y el pozo siguen igual.
- Si se toca la fórmula, recalcular: `SELECT public.recompute_user_total(id) FROM public.users;`

## Despliegue
- **Vercel** despliega frontend Y backend juntos en cada push a `main` (root `vercel.json` → `experimentalServices`, backend `@vercel/python` bajo `/_backend`).
- Cron de marcadores: GitHub Actions `sync-live-scores.yml` (cada ~5 min) → `POST /_backend/api/matches/sync-live`.
- Migraciones SQL: el admin las corre a mano en el SQL Editor de Supabase (archivos en `database/`).

## Al cambiar reglas de puntaje
1. Cambiar **ambos** motores (`scoring.js` y `scoring.py`) para que coincidan.
2. Actualizar la tarjeta correspondiente en `frontend/src/pages/RulesPage.jsx`.
3. Avisar al grupo. Si hay partidos ya puntuados con la regla vieja, recalcular (`recalc-scores`).
