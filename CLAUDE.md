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
- Es la ÚNICA vía para anular un partido: tanto el backend (`scoring.py`, syncs) como el frontend (`lib/scoring.js`, usado por AdminPage) llaman a esta función en vez de tocar `predictions` directo — necesario porque cuando se escribió eso las políticas RLS de `predictions` solo dejaban escribir al propio usuario o a `service_role`. **Ojo, esto quedó desactualizado**: producción tiene además `predictions_update_admin` y `predictions_insert_admin` (`users.is_admin = true`), que NO están en ningún archivo de `database/` — se crearon a mano en el dashboard. Aun así, seguir usando `void_cancelled_match`: es la vía que además devuelve el comodín y otorga el crédito de arrastre.
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
- **`users` tiene permisos POR COLUMNA**: `select('*')` sobre esa tabla ahora falla con *permission denied* (el `*` se expande a `email`, que dejó de ser legible). Pedir siempre columnas explícitas. Esto rompía el arranque de sesión entero en `AuthContext`.
- `/refresh-live` dejó de ser público: toda llamada va por `lib/refrescoEnVivo.js`, que adjunta el token. Las tres pantallas que lo usan fallan en silencio, así que si se olvida el token el marcador deja de avanzar sin mostrar ningún error.
- `check_powerup_limit` toma `pg_advisory_xact_lock` por (usuario, liga, fase, jornada) antes de contar. Sin eso, dos envíos simultáneos se pasan del cupo (comprobado: cupo 1 → 2 comodines guardados).

- **Toda RPC nueva que llame el frontend hay que agregarla al inventario `v_frontend` de la migración 61.** Ese `REVOKE` es en bloque: una función que no esté en la lista se queda sin permiso la próxima vez que se corra la 61, y la pantalla deja de funcionar sin decir por qué. Pasó con las tres RPC de la 63 y lo cazó una auditoría, no nosotros.
- **`powerup_limits` ya NO controla el puntaje** (desde la migración 48): el cupo real es `leagues.powerup_limit`, por quiniela. La tabla quedó de solo lectura (migración 64) y el panel de admin que la editaba se borró, porque guardaba, decía "listo" y no cambiaba el límite aplicado.
- Las **vistas** (`user_badges_view`, `user_stats_view`, `user_tournament_points`) corren con los privilegios de quien las creó, así que **saltan la RLS**. Nacieron abiertas a `anon`. Al crear una vista nueva, revocar explícitamente.
- Las pantallas que consumen RPC tienen que **mostrar el error**, no desaparecer ni dejar un spinner girando: si no, un permiso que falta se vuelve invisible.

- **Las predicciones ajenas se destapan solo entre miembros de la misma quiniela** (migración 65). Antes la política solo miraba la hora del saque, sin filtrar por liga: con la app pública, cualquiera que se registrara podía leer las predicciones de todo el mundo. `MatchDetailPage` no filtra por liga y ahora depende de esa política para acotarlo.
- **Las políticas permisivas se COMBINAN CON OR.** `predictions` tenía dos de SELECT apiladas (`predictions_select_own` y `..._others_strict`) y la más laxa mandaba. Antes de endurecer una política, mirar si hay otras sobre la misma tabla y comando — una `FOR ALL` también concede SELECT.

## Ranking global (migración `database/62_ranking_global_sin_duplicados.sql`)
- `user_total_calculado(user_id)` es la **única** fórmula del total global. Antes estaba escrita dos veces (SQL y JS) y por eso una se olvidó de los puntos de asistidor durante meses.
- Cada **partido** cuenta una vez (el mejor puntaje entre tus quinielas) y cada **torneo** una vez para campeón/goleador/asistidor. Sin esto, estar en más quinielas inflaba el ranking global.
- **No cambia nada dentro de cada quiniela**: `league_points`, la Tabla, las jornadas y el pozo siguen igual.
- Si se toca la fórmula, recalcular: `SELECT public.recompute_user_total(id) FROM public.users;`

- **`vercel.json` es JSON estricto y Vercel valida el esquema**: una clave desconocida (incluida una `"//comentario"`) hace **fallar el despliegue entero**, con un error genérico que apunta a la documentación de configuración. No meter comentarios ahí; documentar acá.
- El CSP sale como `Content-Security-Policy-Report-Only` a propósito: se ajustó contra el build real (sin scripts ni estilos inline, sin `eval`) pero no se comprobó contra producción. En Report-Only el navegador avisa en consola y no bloquea. **Cuando se confirme que no reporta nada, renombrar la cabecera a `Content-Security-Policy`** para que proteja de verdad.

## Global vs por quiniela (migración `database/63_hub_global_y_perfiles.sql`)
Son **dos números distintos a propósito** y confundirlos es el error fácil:
- **Global** (`users.total_points`, `user_total_calculado`): junta todas las quinielas y cuenta cada partido UNA vez. Vive en el hub (`components/hub/RankingGlobal.jsx`) y en el perfil (`ProfilePage`). RPCs: `ranking_global(limite)`, `mi_resumen_global()`.
- **Por quiniela** (`league_points`, `league_table`): solo esa quiniela. Vive en la Tabla y en `components/tournament/PerfilEnQuiniela.jsx`, que se abre tocando cualquier fila (también la propia) y desde ahí se pasa al Cara a cara.
- `perfil_en_quiniela()` **no recalcula nada**: reusa `league_table` (desempate oficial) y `league_jornadas` (rachas). No inventar criterios nuevos acá.
- Ambas pantallas llevan un cartel que explica la diferencia: sin eso los dos números se ven distintos y parecen un error.

## Deriva entre el repo y la base
- Las migraciones se corren a mano, así que **`schema.sql` ya no describe la base**. Ya mordió dos veces: `predictions_update_admin`/`predictions_insert_admin` existen solo en producción, y la migración 61 dejó mudas tres RPC nuevas por no estar en su inventario.
- **`database/verificar_estado.sql` es de SOLO LECTURA** y compara la base viva contra el repo: funciones que faltan o sobran, RPC sin permiso, `SECURITY DEFINER` alcanzables por `anon`, tablas escribibles por `anon`, vistas abiertas, las políticas de `predictions` y los totales descuadrados. Correrlo después de aplicar migraciones y antes de cualquier cambio grande.
- Se genera desde el repo: si se agregan funciones, hay que **regenerarlo** para que la lista siga siendo cierta.

## Verificación de correo
- La fuente de verdad es `auth.users` (la sesión de Supabase), **no** una columna en `public.users`: `email_confirmed_at` nunca existió ahí y la consulta fallaba, caía al `catch` y dejaba pasar a todos.
- `lib/verificacionCorreo.js` distingue **tres** estados: timestamp → entra · `null` explícito → bloqueado · claves ausentes → entra igual con aviso en consola. Ese tercer caso es a propósito: dejar afuera a alguien legítimo por un cambio de forma del SDK sería peor que el agujero que cierra.

## Partidos del día y aviso de las 6 am
- **Costa Rica es UTC-6 todo el año** (sin horario de verano), así que 6 am local = 12:00 UTC fijas y el día natural va de 06:00Z a 06:00Z. Usar el día UTC haría que un partido de las 8 pm de ayer apareciera como de hoy.
- Las horas del texto de WhatsApp se convierten con ese offset **fijo**, no con la zona del dispositivo: si no, alguien de viaje mandaría horas distintas al resto del grupo.
- El texto **no lleva predicciones ni marcadores**: circula por WhatsApp y no debe filtrar lo que la app protege con RLS.
- **Solo se avisa si TU quiniela tiene partidos hoy**: se filtra torneo → quiniela → miembro, y además se excluyen los torneos `finished`. La liga tica corre temporada tras temporada sobre el mismo `tournament_id`, así que sin ese segundo filtro los miembros de una quiniela vieja recibirían avisos de partidos que no están jugando.
- El push de las 6 am es `POST /api/matches/notify-daily`, protegido con `CRON_SECRET`, disparado por `.github/workflows/resumen-diario.yml`. Va en el backend y **no** en una edge function: acá ya está la autenticación y el envío de push, y se despliega solo con cada push a `main`.
- **Ojo**: la base **no tiene `pg_cron` ni `pg_net`**, y el repo no tiene ninguna acción que llame a `notify-upcoming`. Esa edge function está desplegada (v4) pero puede que **nadie la dispare**: hay que confirmar si algo externo la invoca.

## Panel de admin por quiniela (pestaña Admin)
- `components/tournament/PanelAdminQuiniela.jsx`, pestaña propia **aparte de Reglas**. Reglas la ve todo el grupo (reglas y pozo son material de confianza); esto son ACCIONES que solo un admin ejecuta, y mezclarlas haría que la mayoría vea botones que no puede usar.
- La ve: el creador, los co-admins (`group.is_admin` ya es `es_admin_liga`) y el **admin global** (`users.is_admin`), que entra siempre aunque no juegue esa quiniela.
- Acciones: mandar el push de los partidos de hoy a esa quiniela, y compartir la imagen PNG del día.
- **No toca resultados de partidos**: son compartidos con las demás quinielas del torneo, eso sigue siendo del panel global.
- El endpoint `POST /api/matches/notify-daily-league` comprueba el permiso **contra las tablas, no con `es_admin_liga()`**: esa función mira `auth.uid()`, y el backend corre con `service_role`, donde es NULL — la RPC diría que no es admin siempre.

## Acceso del admin global (migración `database/66_acceso_del_admin_global.sql`)
- El admin global (`users.is_admin`) **puede entrar a cualquier quiniela y ver lo mismo que un miembro**: tabla, histórico, predicciones destapadas, pozo, medallas. Decisión explícita del dueño.
- Se hace con `puede_ver_quiniela(league_id)` = `is_league_member OR es_admin_global`. **No se ensanchó `is_league_member`** a propósito: esa función se llama así porque responde "¿es miembro?", y hacerla mentir abriría un agujero la próxima vez que alguien la use para un permiso de escritura.
- **Ver no es actuar**: `accept_group_rules`, `avisar_pago`, `cast_rule_vote` y `set_league_admin` siguen exigiendo membresía real. Un admin global no vota ni paga por otros.
- **El destape de 15 minutos se respeta igual**: nadie ve las predicciones ajenas antes del saque, tampoco el dueño de la app. Verificado con una prueba dedicada.
- `my_groups()` se dejó intacta: si devolviera todas las quinielas, el hub del admin se llenaría de grupos de desconocidos. Para abrir una ajena está `quiniela_por_id(league_id)`, y `GroupPage` cae a esa cuando la quiniela no está en tu lista.
- La pantalla muestra un cartel permanente cuando estás viendo una quiniela de la que no sos miembro.

## Despliegue
- **Vercel** despliega frontend Y backend juntos en cada push a `main` (root `vercel.json` → `experimentalServices`, backend `@vercel/python` bajo `/_backend`).
- Cron de marcadores: GitHub Actions `sync-live-scores.yml` (cada ~5 min) → `POST /_backend/api/matches/sync-live`.
- Migraciones SQL: el admin las corre a mano en el SQL Editor de Supabase (archivos en `database/`).

## Al cambiar reglas de puntaje
1. Cambiar **ambos** motores (`scoring.js` y `scoring.py`) para que coincidan.
2. Actualizar la tarjeta correspondiente en `frontend/src/pages/RulesPage.jsx`.
3. Avisar al grupo. Si hay partidos ya puntuados con la regla vieja, recalcular (`recalc-scores`).
