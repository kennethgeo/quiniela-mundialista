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
- El CSP se aplica como `Content-Security-Policy` (enforcement). Si se agrega un origen externo para scripts, estilos, fuentes, imágenes, conexiones, workers o medios, hay que incorporarlo de forma explícita en `vercel.json` y comprobarlo en el despliegue; no volver a `Report-Only` como arreglo permanente.

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
- **Tercera mordida: la migración 27 nunca se corrió.** `tournament_predictions` conservaba el `UNIQUE (user_id)` que nació en la 05, cuando había un solo torneo. Eso limita a **una predicción global por persona en TODA la app**: al guardar campeón/goleador en una segunda quiniela salía `duplicate key value violates unique constraint "tournament_predictions_user_id_key"`. Lo arregla la migración 71.
- **La 71 YA ESTÁ APLICADA** (7 sep 2026): comprobado leyendo `pg_constraint`, en producción queda solo `UNIQUE (user_id, league_id)` y las 15 predicciones existentes no se tocaron.
- **La 27 pedía `UNIQUE (user_id, tournament_id)`; eso hoy sería otro bug.** Las predicciones globales son **por quiniela**, y dos quinielas pueden compartir torneo — la liga tica corre temporada tras temporada sobre el mismo `tournament_id`. La restricción correcta es `UNIQUE (user_id, league_id)` (migración 37), que es a la que apunta el `onConflict` del cliente.

## Verificación de correo
- La fuente de verdad es `auth.users` (la sesión de Supabase), **no** una columna en `public.users`: `email_confirmed_at` nunca existió ahí y la consulta fallaba, caía al `catch` y dejaba pasar a todos.
- `lib/verificacionCorreo.js` distingue **tres** estados: timestamp → entra · `null` explícito → bloqueado · claves ausentes → se comprueba con `auth.getUser()` antes de entrar, con límite de 4 segundos y reintento visible si falla. El resultado debe pertenecer al mismo usuario. Una sesión con el timestamp esperado no agrega ninguna consulta. Un `null` no puede perderse porque el campo alternativo esté ausente.
- Las respuestas de `public.users` se invalidan por cambio de usuario, cierre de sesión y orden de solicitud. Una respuesta lenta del perfil anterior nunca puede reemplazar el perfil de la nueva cuenta. La suscripción atiende también `INITIAL_SESSION`; no depender solo de `SIGNED_IN` para cargar un perfil al recargar.

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
- **`es_admin_global()` es un ayudante INTERNO**: no lo llama ningún cliente ni ninguna política, y NO tiene EXECUTE para `authenticated`. Lo invoca `puede_ver_quiniela()`, que al ser `SECURITY DEFINER` lo ejecuta como su dueño. Por eso **no va en el inventario de la 61**; `puede_ver_quiniela` sí, porque se evalúa dentro de las políticas RLS.
- **`CREATE OR REPLACE` conserva el ACL de una función; `DROP` + `CREATE` lo reabre a `PUBLIC`** (comprobado). Al redefinir una función ya endurecida, usar siempre `CREATE OR REPLACE`.
- Las verificaciones de la 66 usan `RAISE EXCEPTION`, no `WARNING`: una base a medio endurecer es peor que una sin endurecer, porque parece segura.

## Login que se queda en "Entrando…"
- `signInWithPassword` **no tiene tiempo límite propio**: si la petición no vuelve, la promesa no resuelve, el `finally { setLoading(false) }` nunca corre y el botón queda muerto, sin error y sin reintento. Pasó en producción (ago 2026). Todo lo que espere a la red en una pantalla bloqueante necesita `conLimite()` (`lib/loginResiliente.js`).
- **Al vencer el plazo NO se da el intento por fallado**: la petición pudo haber entrado y habérsenos perdido la respuesta. Se comprueba `getSession()` con un límite corto; solo si no hay sesión se muestra el error.
- El botón de rescate usa `signOut({ scope: 'local' })`. **Nunca el global**: cierra la sesión en todos los dispositivos de la persona y encima necesita la red que puede estar caída.
- Los logs de login guardan **solo categoría y duración** (`describirFallo`), nunca el mensaje crudo del servidor: eso queda en la consola del dispositivo ajeno.
- **No es el Web Lock**, aunque sea el primer sospechoso al buscar en internet: desde `auth-js` 2.x todos los `_acquireLock` están detrás de `if (this.lock != null)` y `lock` es `null` salvo que le pases uno propio — no lo hacemos, y el bundle no contiene `navigator.locks`. Comprobado leyendo el paquete instalado, no la documentación.
- Para distinguir "no llegó" de "llegó y falló": en `edge_logs` contar `OPTIONS` contra `POST` sobre `/auth/v1/token`. Muchos preflights y casi ningún POST = el navegador no está mandando la petición, y no hay nada que arreglar en la base.

## Tarjeta compartible (escudos y fotos de estadio)
- Los escudos SÍ se pueden dibujar en el canvas: `flagcdn` y `a.espncdn` responden `access-control-allow-origin: *`, así que con `crossOrigin='anonymous'` no dejan el canvas *tainted*. El comentario de `shareCard.js` que decía lo contrario estaba desactualizado y bloqueó la idea un buen rato.
- **Nada de lo externo es obligatorio**: `cargarImagen()` nunca rechaza — devuelve `null` si falla o si tarda más de 4 s, y la tarjeta se dibuja sin esa imagen. Un escudo lento no puede dejar al grupo sin su tarjeta.
- Las imágenes se cargan **en paralelo**. En serie, tres partidos con el CDN lento sumarían doce segundos antes de ver nada.
- **ESPN da el NOMBRE del estadio, nunca una foto.** Las fotos van a mano en `frontend/public/estadios/` y se mapean en `lib/estadios.js` por nombre normalizado (sin tildes, minúsculas, espacios colapsados) porque la fuente escribe el mismo estadio de varias formas. Sin foto, la fila usa el fondo sólido.
- El velo oscuro sobre la foto (`rgba(12,12,12,.78)`) no es decorativo: WhatsApp comprime la imagen y mucha gente la ve primero como miniatura. Sin velo, el nombre de los equipos sobre una gradería no se lee.
- `matches.venue` existía en `schema.sql` desde el principio pero **ningún sync lo escribía**: estaba siempre en NULL. Lo llena `espn_tournament_sync` desde `competitions[0].venue.fullName`.

## Recordatorio 45 min antes del saque
- El resumen de las 6 am ya dice cuántas te faltan, pero es **una vez al día**: si el partido es a las 8 pm y lo viste temprano, nada te vuelve a tocar. Perder una jornada por olvido es la peor experiencia en una quiniela por plata.
- `POST /api/matches/notify-kickoff` (mismo `CRON_SECRET`), disparado por `.github/workflows/recordatorio-saque.yml` **cada 15 minutos**.
- **Solo se avisa a quien tiene predicciones pendientes.** A quien ya predijo no se le manda nada: un aviso que no pide nada es el que hace que la gente apague las notificaciones, y entonces tampoco le llegan los que sí importan.
- **El ancho de la ventana coincide con el intervalo nominal del cron** (`ANCHO_VENTANA_MIN = 15`). Solo evita solapamientos si las ejecuciones reales quedan separadas exactamente 15 minutos. `test_recordatorio_saque.py` comprueba esa cadencia ideal; no demuestra idempotencia frente a atrasos o reintentos.
- La ventana es `[45, 60)` minutos: cerrada abajo y **abierta arriba**, para que un saque justo en el borde no entre en dos corridas.
- **Pendiente: deduplicación persistente con reclamación atómica antes de enviar.** Un atraso desigual sí duplica: ejecución de las 12:00 a las 12:10 → [12:55, 13:10); ejecución puntual de las 12:15 → [13:00, 13:15). Un saque a las 13:05 entra en ambas. Ajustar la ventana o guardar un flag en memoria no resuelve concurrencia/reintentos. Este registro aún no está implementado; necesita diseñar también la recuperación ante fallos de envío.
- **La deduplicación no recupera corridas ausentes.** Evaluar también la frecuencia real del disparador y la cobertura de partidos en el historial operativo. El arreglo necesita ambas cosas: disparador fiable y registro persistente. Una prueba de la ventana en aislamiento no mide cuántos avisos recibieron las personas.

## Cupo de comodines ×2 que escala con la jornada (migración `database/67_cupo_comodines_por_tamano.sql`)
- `leagues.powerup_limit` es **un** número por quiniela y se aplica por `(fase, jornada)`. Con la liga tica (~5 partidos) un cupo de 2 es razonable; en la fase de liga de la Champions son **18 partidos por jornada** y ese mismo 2 casi no se nota, mientras que en una final de 1 partido es no tener límite.
- Ahora hay una razón opcional, `leagues.powerup_por_partidos` = "1 comodín cada N partidos". La fórmula es `cupo = GREATEST(powerup_limit, CEIL(partidos / powerup_por_partidos))`, o sea que **`powerup_limit` pasa a ser el mínimo**.
- **Nace en NULL y con NULL nada cambia**: el cupo es exactamente `powerup_limit`, igual que antes. Ninguna quiniela se ve afectada hasta que su admin ponga la razón.
- **`cupo_powerups()` es la ÚNICA fórmula.** La usa el trigger que valida Y la consulta el frontend (vía `cupos_por_jornada`) para pintar "quedan N". No calcular el cupo en JS: este repo ya vivió la fórmula escrita dos veces —los puntos de asistidor se olvidaron en una copia durante meses— y acá el síntoma sería peor: la app mostraría un cupo que la base no respeta.
- **El trigger agrupa por `(phase, matchday)`, pero `powerupKey()` de `lib/powerups.js` colapsa tercer puesto y final en un solo grupo.** Esa discrepancia ya existía; `cupos_por_jornada` sigue al trigger, que es quien manda.
- `set_group_scoring` necesitó **`DROP` + `CREATE`** para aceptar el parámetro nuevo (no se puede cambiar la firma con `CREATE OR REPLACE`). Eso **reabre el ACL a `PUBLIC`**, así que la migración revoca y re-otorga a mano, y lo comprueba al final.
- `powerup_por_partidos` se guarda **sin `COALESCE`** con el valor viejo: NULL significa "cupo fijo", y un `COALESCE` impediría desactivarlo.

## La pestaña y la jornada viven en la URL
- Al entrar a **Detalles del Partido**, `GroupPage` se **desmonta**. Con la pestaña en `useState`, al volver atrás arrancaba de cero y te dejaba en «Resumen» aunque estuvieras en «Partidos». Ahora van en la query (`?tab=matches&j=Jornada 7`), que el historial restaura sola.
- Se usa **`replace: true`** al cambiar de pestaña: si se empujara al historial, el botón de atrás recorrería las pestañas una por una en vez de salir de la quiniela. La URL igual queda en el historial, así que volver de un partido restaura el estado.
- La jornada por defecto **ya elegía bien** la primera con partidos por jugar. Lo que faltaba era que la fila de chips se **desplazara** hasta ella: en un torneo de 8 jornadas, la activa quedaba fuera de pantalla. Lo hace `scrollIntoView` con **`block: 'nearest'`** — sin eso también mueve la página verticalmente y te deja a media pantalla.
- **Una prueba de navegación que solo mira los query params NO sirve**: la URL conserva los parámetros aunque la app los ignore, así que pasa igual con el bug puesto. Comprobado. Hay que afirmar sobre lo que se ve (que existan los chips de jornada, que solo están en «Partidos»).

## Filtrar los partidos de una jornada
- **Medido en la pantalla**: una jornada de la fase de liga de la Champions trae **18 partidos**. Los ya jugados van primero (el orden es por fecha), así que para llegar a los de hoy —los únicos sobre los que se puede hacer algo— hay que bajar por toda la lista. Con los ~5 de la liga tica no se nota; con 18 sí.
- Tres filtros, en `lib/filtroPartidos.js` (puro y probado): **Por predecir** (abierto y todavía sin marcador puesto), **Hoy** y **Por jugar** (todo lo que no terminó, en curso incluidos). Más «Todos».
- **La pantalla ABRE filtrada en «Por jugar»** (`filtroInicial`). Primero se dejó «Todos» por no cambiarle la vista al grupo, y el dueño lo reportó **dos veces**: «sigo teniendo que bajar a ver los de hoy». Un filtro que hay que ir a buscar no resuelve el problema, lo hace resoluble — que no es lo mismo. Se elige «Por jugar» y no «Por predecir» porque **no depende de lo que hayas predicho**: la pantalla no cambia de forma según cómo vas, y no esconde nada sobre lo que se pueda actuar.
- Si en la jornada **no hay nada terminado**, abre en «Todos»: filtrar no ahorraría un píxel. Y en una jornada ya cerrada también, porque «Por jugar» daría cero.
- **«No elegiste» y «elegiste Todos» son estados DISTINTOS.** Confundirlos rompe las dos mitades: si la ausencia del parámetro diera «Todos», la pantalla nunca abriría filtrada; si «Todos» no se guardara, tu elección se perdería al volver de un partido y volvería a filtrar sola. Por eso la URL escribe `f=todos` explícito en vez de borrar el parámetro.
- **La cuenta de los chips es SIEMPRE de la jornada entera**, no de lo que dejó el filtro: si no, «Todos» diría 3 estando filtrado y no habría forma de ver qué se esconde.
- **El filtro se aplica DENTRO de la jornada elegida, no sobre el torneo.** En la Champions las 8 jornadas se publican de una, así que un «por predecir» de todo el torneo devolvería ~126 partidos: más de los que ya hay que bajar. Lo que acota es la jornada; el filtro la afina. Para cruzar jornadas está el chip «Todas», que también es una selección de jornada.
- **Ninguna combinación puede dejar la lista vacía.** Un chip con 0 partidos no se dibuja, y un filtro guardado en la URL que se queda sin nada al cambiar de jornada cae a «todos» (`filtroEfectivo`, derivado — no se guarda). Una pantalla en blanco se lee como «la app se rompió» y no da ninguna pista.
- Cada chip lleva **su cuenta**: un filtro que esconde cosas solo se entiende si se ve cuánto esconde y cuánto había.
- Vive en la URL (`?f=hoy`) por lo mismo que la pestaña y la jornada: al entrar a Detalles del Partido `GroupPage` se desmonta.
- **Predicho = hay fila Y tiene marcador.** Una fila a medias no es una predicción y ese partido se sigue debiendo.
- **El calendario exporta LA JORNADA, no lo que dejó el filtro**: su selector dice «Jornada 1» y mandarle un subconjunto sería exportar menos de lo que promete — el fallo de «guarda, dice listo y no hace lo que dice» otra vez.

### Lo primero que se ve tiene que ser un partido que se pueda predecir
Filtrar no alcanzaba: encima de la lista había ~850 px de encabezados en una pantalla de 800. Los tres bloques, en orden de lo que ocupaban:
- **La tarjeta «Hoy se juegan N»** era el más alto (~22% de la pantalla con 6 partidos). Ahora la lista de horas **se pliega sola a partir de 4** (`CUANTOS_SIN_PLEGAR`); el encabezado —cuántos son— y el botón COMPARTIR se ven siempre, que es lo que de verdad se usa desde ahí. No se quitó: con la lista desplegada se leen las horas de un vistazo y sin ella el grupo se queda sin su imagen de WhatsApp.
- **`ExportarCalendario` pasó DEBAJO de la lista.** Es un botón que se usa una vez por torneo y estaba empujando los partidos fuera de pantalla.
- El filtro inicial, arriba.
- `filtro-partidos.spec.js` mide el resultado, no las piezas: afirma que el botón «Guardar predicción» del primer partido **entra en la primera pantalla** (`boundingBox` contra el alto del viewport). Es la única forma de que la prueba siga significando algo si mañana se agrega otro cartel arriba.
- El colchón de 128 px que vivía dentro de `MatchList` se movió al final de la pestaña: con el calendario abajo quedaba **en medio**. Su comentario decía que era «para que el BottomNav no tape el último partido» y **eso no es cierto**: la barra es `flex-none` al final de la columna y `main` scrollea por dentro (`App.jsx`), así que nunca se superpone. Es aire, no protección. Escribí una prueba para el tapado y **pasaba con y sin el colchón** — una prueba que no puede fallar es peor que ninguna, así que se quitó en vez de dejarla dando confianza falsa.
- `filtro-partidos.spec.js` abre la pantalla y afirma **qué partidos se ven**, nunca los query params (la URL los conserva aunque la app los ignore). Comprobado que cae con la pantalla ignorando el filtro, sin la caída a «todos», con el día UTC en vez del de Costa Rica, y contando una fila a medias como predicha.
- El reloj de esa prueba va **clavado** (`page.clock.setFixedTime`): «hoy» depende de la fecha y si no cambiaría de resultado según a qué hora corra CI.
- **`/rest/v1/users` se simula como OBJETO, no como lista**: `AuthContext` lo pide con `.single()`, y con una lista el perfil queda en null — sin perfil la app ni siquiera consulta las predicciones, así que «Por predecir» las contaba todas. Pasó al escribir esta prueba.

## Cupo de ×2 por fase (migración `database/68_cupo_por_fase.sql`)
- La 67 dejó dos formas de fijar el cupo —número fijo y razón "1 cada N partidos"— y **ninguna deja decir "en la fase de liga tres, pero en la final uno"**. Los formatos son muy distintos: 18 partidos por jornada en la Champions, 8 en los octavos, 1 en la final.
- `leagues.powerup_limits` es un jsonb `{"groups":3,"Octavos":2,"Final":1}`.
- **La clave la da `clave_fase()`** (corregida en la 72, ver abajo): `phase` cuando es específica (`round_of_16`, `final`…) y, solo para el comodín `'knockout'`, la etiqueta de `matches.stage` cortada en `' · '` (`'Octavos · Ida'` → `'Octavos'`), porque el cupo es de la ronda, no de cada partido.
- **Orden de resolución**: cupo de la fase → razón → número fijo. Una fase **sin entrada usa el número fijo, NO cero** — cuando ESPN publique los octavos en enero, nadie se queda sin comodines por no haberlos configurado.
- El editor muestra las fases que existen en ese torneo (`fases_del_torneo`) **y, desde la 72, deja agregar las que todavía no**.
- **Antecedente que no hay que repetir**: ya existió una tabla `powerup_limits` por fase y se quitó en la migración 48 porque el panel guardaba, decía "listo" y **no cambiaba el límite aplicado**. Acá el valor entra en `cupo_powerups()`, que es la que usa el trigger.
- Dos cosas de Postgres que aparecieron al escribirla: **un `CHECK` no admite subconsultas** (recorrer las claves del jsonb necesita una, así que va en una función `IMMUTABLE`), y **`CREATE OR REPLACE` no puede cambiar el tipo de retorno** de una función que devuelve `TABLE` — hay que soltarla, lo que reabre su ACL.

## Cupos de ×2 en fases que aún no existen (migración `database/72_cupos_por_fase_configurables.sql`)
La 68 dejó el editor **inservible justo cuando hace falta usarlo**. Dos causas distintas, las dos comprobadas contra producción:
- `fases_del_torneo` sale de `matches`, y la Champions y la liga tica solo tienen `groups`: ESPN publica los octavos en enero y las finales de la liga tica al final del torneo. Encima `CuposPorFase.jsx` se ocultaba con una sola fase. **El cupo hay que poder decidirlo ANTES de que la fase empiece**; después ya es cambiar las reglas en marcha.
- `clave_fase` resolvía por `stage`, que en el Mundial es NULL: `round_of_32`, `round_of_16`, `quarter_finals`, `semi_finals`, `third_place` y `final` caían las seis en `'knockout'`. 32 partidos con un mismo número, sin manera de dar 1 en la final y 3 en los octavos. **El trigger que valida ya agrupaba por fase; el que colapsaba era el que elegía el número.**
- `fases_del_torneo` devuelve ahora las fases con partidos **más** las que ya tengan cupo guardado (`FULL OUTER JOIN`), con una columna `existe boolean`. Sin eso, una fase configurada por adelantado desaparecía de la pantalla hasta que ESPN la publicara.
- El editor permite **agregar una fase a mano** con sugerencias y campo libre (cada torneo escribe sus rondas a su manera), la marca «aún sin partidos», y no guarda nada hasta pulsar Guardar. Un cupo guardado que la RPC no devuelva ya no se pierde al abrir la pantalla.
- Sigue en pie lo de la 68: una fase **sin entrada usa el número fijo, NO cero**.
- **El nombre de la fase que escribe el admin ES la clave**, no una etiqueta: en la liga tica y en la Champions las eliminatorias llegan con `phase = 'knockout'` y la clave sale de `matches.stage`. Un nombre que no coincida exacto guarda un cupo que **nunca se aplica** — guarda, dice «listo» y el trigger sigue con el número fijo, que es el fallo de la 48 otra vez. Se sugerían «Semis» y «Play-offs»; el sync escribe **«Semifinal»** y **«Repechaje»**, y a la tica le faltaba **«Liguilla»**.
- Las sugerencias viven en `lib/fasesDeTorneo.js` y son las etiquetas literales de `_STAGE_KEYS` (`espn_tournament_sync.py`). `fasesDeTorneo.test.js` **lee ese archivo de Python** y falla si las dos listas se separan: copiar los valores sería repetir el problema de tener la misma lista escrita dos veces. Comprobado que la prueba cae al reintroducir «Semis».

## Una sola llave de cupo de ×2 (migración `database/73_una_sola_llave_de_cupo.sql`)
El cupo se **elegía** por fase pero se **contaba** por otra cosa. Reproducido en Postgres con la postemporada real de la liga tica: con `{"Semifinal":2,"Final":1}`, gastar los 2 en semifinales dejaba la final **sin ningún comodín**.
- `cupo_powerups` elegía el número por `clave_fase()` → `Semifinal`/`Final`; `check_powerup_limit` contaba por `(phase, matchday)` → `('knockout', NULL)` para TODA la eliminatoria.
- **En el Mundial no se veía** porque ahí cada ronda trae su propia `phase` y las dos agrupaciones coincidían por casualidad. En la liga tica y en la Champions la eliminatoria entera llega con `phase='knockout'` y jornada nula.
- Ahora la bolsa es **`llave_cupo(match)` = clave de fase + jornada**, y la usan el trigger, `cupo_powerups`, `cupos_por_jornada` y los créditos de arrastre (`powerup_credits.phase` guarda la **clave**, no la fase cruda).
- La razón "1 cada N partidos" también cuenta los partidos **de esa ronda**: antes contaba toda la fase y en la postemporada tica daba 6 para cualquier ronda.
- La migración va **dentro de una transacción** y comprueba **antes** de tocar nada que nadie quede pasado de cupo al partirse su bolsa. La comprobación mide el **estado final**, no la diferencia, para que sea idempotente: una que miraba "cambió de bolsa" saltaba en falso la segunda corrida (comprobado).
- **`llave_cupo` es interna**: la llaman funciones que ya son `SECURITY DEFINER`, así que no lleva EXECUTE para nadie y **no va en el inventario de la 61** (mismo caso que `es_admin_global`).
- **La pantalla tiene que ARMAR la llave con `llaveDeCupo`, no con una plantilla.** `cupoDe` en `GroupPage` componía `` `${m.phase}|${m.matchday}` `` contra un mapa que viene con la **clave de fase**: para una eliminatoria de liga buscaba `knockout|0` donde el mapa tiene `Semifinal|0`, no encontraba nada y caía al cupo general — la pantalla mostraba un número que el trigger no aplica. **En fase de grupos las dos formas coinciden, por eso no se veía**: se rompía al llegar la postemporada.
- La regla está escrita **dos veces a la fuerza** (`clave_fase` en SQL y `claveDeFase` en `lib/powerups.js`): el navegador no puede llamar a la función para cada partido de una pantalla. Los dos lados **fijan los mismos casos** — el bloque final de la 73 y `powerups.test.js` — así que cambiar uno rompe la comprobación del otro.

## Las fases que ESPN publica de verdad
Comprobado consultando el scoreboard (uefa.champions y crc.1, temporadas 2025 y 2026), no supuesto. `backend/tests/test_fases_reales.py` fija estos slugs:
- **Champions**: `league-phase` (144 partidos, 8 jornadas, 36 equipos) · `knockout-round-playoffs` · `round-of-16` · `quarterfinals` · `semifinals` · `final`. Todas las eliminatorias son **ida y vuelta menos la final**.
- **Liga tica**: `apertura`/`clausura` (10 equipos, 18 jornadas, 90 partidos) · `…---playoff-semifinals` (2 series) · `…---playoff-finals` · `…---grand-finals`, que **solo se juega si el líder de la fase regular no gana la final**.
- **`_STAGE_KEYS` se recorre EN ORDEN y devuelve la primera que aparezca en el slug**, así que lo específico va antes que lo genérico. Dos fallos que dejó ese orden: `grand-finals` daba «Final» (la misma clave de cupo que la final, siendo dos series distintas) y `knockout-round-playoffs` daba «Eliminatoria» porque `knockout` se comprobaba antes que `playoff`.
- **Un slug que no se reconoce da `None`, y `None` = fase REGULAR**: jornada por fecha y puntaje **sin las reglas de penales**. Es el modo de fallo peligroso — si aparece una ronda nueva hay que mapearla, no dejarla caer.

## El candado del cupo de ×2 es POR FASE (migración `database/74_candado_por_fase.sql`)
La pantalla de cupos por fase nació **inútil en los dos torneos para los que se hizo**, y no se vio hasta que el dueño intentó usarla: `set_powerup_limits` rechazaba cualquier cambio si `group_tournament_started` era cierto, y esa función mira el **primer partido del torneo**.
- Medido: **Bundestica** arrancó el 2026-07-24 → editor bloqueado con 55 partidos por jugar y toda la postemporada por delante. **Champions 26-27** empieza el 2026-09-08 → se bloqueaba al día siguiente. La ventana real para configurar era de horas.
- **Por qué el candado existe y por qué esto no lo afloja**: en una quiniela por plata, cambiar cuánto vale algo con la tabla a la vista es hacer trampa. Pero fijar el cupo de una fase **que todavía no empezó** no es cambiar las reglas en marcha —nadie predijo nada ahí y ninguna predicción existente cambia de valor— y es el único momento en que se puede decidir. Tocar una fase **ya empezada** sigue prohibido.
- `fase_ya_empezo(league, clave)` mira el primer saque **de esa bolsa**. Una fase sin partidos **no** empezó: es justo la que hay que poder configurar por adelantado.
- `set_powerup_limits` compara el jsonb viejo con el nuevo y **solo rechaza las claves que CAMBIAN**. Reenviar el mismo valor de una fase empezada no es un cambio: si no, no se podría guardar una fase nueva sin borrar antes las viejas.
- Se comprueba **en el servidor**, no solo en la pantalla. El editor pinta el candado por fila con la columna `empezo` de `fases_del_torneo`.
- **`fase_ya_empezo` es interna**: la llama `set_powerup_limits` (que es `SECURITY DEFINER`); el editor recibe `empezo` ya calculado. No lleva EXECUTE para nadie y **no va en el inventario de la 61** — mismo caso que `es_admin_global`.
- `tests/ui/cupos-por-fase.spec.js` abre la pantalla de verdad. **Ninguna prueba de vitest podía ver esto**: todas miran lógica pura y el fallo era que la pantalla no dejaba hacer nada. Comprobado que las tres caen si se devuelve el candado global.

## Quién cambia los cupos de ×2 (migración `database/75_votar_cupos_por_fase.sql`)
- **Editar es solo de admin**, y se comprueba en el servidor: `set_powerup_limits` exige `es_admin_liga`. La pantalla además solo se le muestra a un admin, pero eso es cosmética — quien manda es la RPC.
- **Proponer también es solo de admin** (`propose_rule_change` exige `es_admin_liga`). En este proyecto un miembro no propone: le pide a un admin que lo proponga. Es así para todas las reglas, no solo para los cupos.
- **`_apply_rule_proposal` tenía dos huecos silenciosos**, los dos del tipo «guarda, dice listo y no cambia nada» — el mismo por el que se quitó la tabla `powerup_limits` en la 48:
  - `powerup_por_partidos` **se mandaba** en el payload desde la 67 y **nunca se aplicaba**. El grupo votaba, la propuesta quedaba `approved` y la razón seguía igual.
  - `powerup_limits` no estaba contemplado, y la 74 rechaza tocar una fase empezada diciendo «proponé el cambio y el grupo lo vota» — **una vía que no existía**.
- Se distingue **«no venía en la propuesta»** de **«venía en null»** (`payload ? 'clave'`): un `COALESCE` contra el valor viejo impediría **desactivar** la razón por votación, y un payload viejo sin la clave **borraría** los cupos guardados.
- **La votación SÍ puede cambiar una fase empezada; el admin solo, no.** La regla del grupo no es «esto no se cambia nunca», es «esto no lo cambia una persona sola con el torneo en marcha».
- El editor decide el botón **antes** de pulsarlo: si lo que cambió es una fase ya empezada dice «Proponer cambio al grupo». Reenviar el mismo valor **no** cuenta como cambio — si contara, no se podría guardar una fase nueva sin mandar todo el lote a votación.
- **Una fase en curso se ve CERRADA** (candado, casilla deshabilitada), como la tarjeta de Puntaje. Primero se dejaba escribir y solo cambiaba el botón: el dueño reportó que «aún puedo editar los de fase regular». No se perdía nada —la RPC lo rechaza igual— pero **parecía** que sí se podía. Para tocarla hay que pedir «Proponer un cambio en una fase ya empezada», que es lo que de verdad va a pasar.

## Las reglas de comodines tienen que VIAJAR a la pantalla (migración `database/76_reglas_visibles_y_formato.sql`)
Dos pérdidas silenciosas de datos, del mismo tipo: la pantalla editaba una regla que las RPC **no devolvían**, así que se veía vacía y el siguiente guardado la borraba.
- `powerup_por_partidos` se edita en la tarjeta de Puntaje desde la 67 y **ninguna RPC lo devolvía**. Siempre vacío → guardar cualquier otra cosa del puntaje **borraba la razón**.
- `powerup_limits` igual: `valores={group.powerup_limits || {}}` era **siempre `{}`**. Los cupos guardados no se veían y, como el guardado manda el objeto entero, guardar una fase nueva **perdía todas las demás**. No se había notado porque hasta la 74 el editor estaba bloqueado en los dos torneos donde se usa.
- **Regla general**: si una pantalla EDITA un campo, la RPC que alimenta esa pantalla tiene que DEVOLVERLO. Con un guardado que manda el objeto completo, no devolverlo no es "se ve vacío", es **borrado silencioso**.

### Las rondas que se ofrecen dependen del torneo
- `tournament_ref` (`tournaments.external_ref`) viaja ahora en `my_groups`/`quiniela_por_id`, y `FASES_POR_TORNEO` (`lib/fasesDeTorneo.js`) dice qué juega cada uno: `crc.1` → Semifinal · Final · Gran final; `uefa.champions` → Repechaje · Octavos · Cuartos · Semifinal · Final; `esp.1`/`eng.1` → nada (liga pura); `fifa.world` → nada (trae la ronda en `phase`, sus filas salen solas).
- **Por qué**: la tica ofrecía «Octavos» y «Dieciseisavos», que no juega. Configurar eso guarda un cupo que **nunca se aplica** y no da ningún error.
- **No es una jaula**: un torneo desconocido recibe la lista completa, hay un «ver todas» y el campo de texto acepta cualquier nombre. Un formato cambia, y quedarse sin poder configurar es peor que ver una ronda de más.
- `fasesDeTorneo.test.js` comprueba que **ninguna ronda de ningún formato es inventada**: todas tienen que ser etiquetas que el sync sepa escribir.

## Aviso en la app para activar notificaciones
- **Medido**: 9 de 22 jugadores tenían push activado. El interruptor vivía —y sigue viviendo— en el **Perfil**, una pantalla a la que casi nadie entra, así que a más de la mitad del grupo no le llegaba ni el resumen de las 6 am ni el recordatorio del saque.
- `components/hub/AvisoNotificaciones.jsx` va **arriba de «Me falta predecir»**, que es justo lo que el aviso sirve para no olvidar. Un modal al entrar se cierra por reflejo.
- **No insiste**: «Ahora no» lo pospone **14 días**, no para siempre. Un aviso que reaparece en cada carga es el que hace que la gente apague TODAS las notificaciones, y ahí se pierden también las que importan; pero alguien que lo cerró sin pensar tampoco debería quedarse sin avisos toda la temporada.
- **Tres situaciones distintas, y confundirlas deja a alguien pulsando un botón muerto**: `denied` (el navegador ya no vuelve a preguntar → se explica dónde está el ajuste, sin botón), **iOS sin instalar** (push solo funciona con la app en la pantalla de inicio) y el resto (se activa ahí mismo).
- **Se ofrece también con `granted` pero sin suscripción**: pasa al actualizar la app o el service worker, y esa persona cree tener avisos que no le llegan.
- La lógica de alta/baja se movió a **`lib/notificaciones.js`**, compartida con el interruptor del Perfil; la decisión de *cuándo ofrecerlo* vive aparte en **`lib/avisoPush.js`** porque `notificaciones.js` importa Supabase y eso no se puede cargar desde vitest.
- **En el Hub las quinielas van PRIMERO en el DOM.** En móvil la grilla se apila en el orden del documento, y con la columna de actividad delante había que bajar por el aviso, «Me falta predecir» y el ranking antes de ver la propia quiniela. Se reordenó el DOM y **no con `order` de CSS**: `order` mueve lo que se ve pero deja el orden de lectura y el del tabulador como estaban. En escritorio la posición no cambia — las columnas se fijan con `xl:col-start-*`.
- **El permiso de notificaciones se fija SIEMPRE en las pruebas, nunca se hereda del entorno**: en CI el navegador arranca con las notificaciones denegadas y en local no, así que las mismas pruebas pasaban acá y caían allá. Lo cazó CI, no la corrida local.
- **El contraste se MIDE pintando el color en un canvas**, no parseando `getComputedStyle` (Tailwind v4 devuelve `oklch(...)` y leer esos números como RGB da ratios inventados). El aviso nació con el botón principal a **1.74:1** —acento `#2ED3B7` sobre su propio fondo al 12%— y `aviso-notificaciones.spec.js` ahora exige 4.5:1 en los dos temas. Comprobado que la prueba cae al devolver el acento.

## Reabrir las predicciones de un partido (migración `database/77_reabrir_predicciones_de_partido.sql`)
- **No existía nada parecido para partidos.** `tournaments.predictions_force_open` (migración 47) reabre solo las **globales**; `matches.score_locked` protege el resultado del sync; y las políticas `predictions_*_admin` dejan al admin global escribir **por otro**, que no es lo mismo que devolverle la predicción al jugador.
- Para qué sirve: ESPN a veces trae mal la hora del saque, o el partido se reprograma. Ahí la gente queda fuera por un error de los datos, no por dormirse.
- **Es por partido**, no por torneo: un interruptor por torneo reabriría también los ya jugados, y eso no es reabrir, es dejar predecir con el resultado a la vista.
- **No vale en partidos finalizados** (ni cancelados ni pospuestos). Se comprueba dentro de la política y **no con un `CHECK`**: un `CHECK` reventaría el sync el día que un partido reabierto termine. El efecto bonito de hacerlo así es que **la reapertura se apaga sola** al finalizar el partido — nadie tiene que acordarse — y el puntaje sale al final con lo que haya, sin recálculo manual.
- **Mientras dura, las predicciones ajenas se vuelven a tapar.** Sin eso la reapertura sería un agujero: pasados los 15 minutos ya están destapadas, así que quien entrara a corregir vería antes las de sus rivales. Una ventana reabierta se comporta como la de antes del saque **en los dos sentidos**. Efecto lateral aceptado: esa fila del Histórico se ve tapada mientras el partido está en curso.
- Se **alteran** las políticas existentes en vez de apilar otras: las permisivas se combinan con OR y repartir la regla en dos sitios es como se coló el agujero de la 65.
- La comprobación final mide el **default de la columna**, no que no haya partidos reabiertos: eso último dejaría de ser cierto en cuanto se use la función y haría fallar una segunda corrida (comprobado).
- **La tarjeta tiene que DEJAR EDITAR, no solo decirlo.** `MatchCard` decidía qué dibujar con `match.status`, así que un partido reabierto seguía mostrando el marcador EN VIVO en vez de los +/−: aparecía el botón «Actualizar predicción» y no había nada que actualizar. Ahora la reapertura manda sobre `isInProgress` para elegir el editor. Lo encontró el dueño, no una prueba.
- La casilla del panel se publicó **duplicada** (dos copias, y la primera sin el candado por estado, así que salía en partidos finalizados). Causa: una edición que parecía rechazada sí se había escrito, y la segunda añadió otra copia. `admin-reabrir.spec.js` exige `toHaveCount(1)`.
- `matchStatus.js` fija los mismos casos que la política. La reapertura **solo pisa lo que estaría cerrado**: en un partido que aún no empieza no cambia nada y decir «Reabierto» ahí sería mentir.

## Detalle del partido: alineaciones, estadísticas y forma (migración `database/78_cache_detalle_partido.sql`)
- Sale del `summary` de ESPN, **recortado en el backend**: el crudo pesa ~200 KB y trae decenas de secciones que la pantalla no usa.
- **Cuándo hay qué** (medido, no supuesto): la **alineación con formación aparece cerca de una hora antes** del saque — a 2 h 40 min ESPN todavía la devolvía vacía y a 28 min ya venía completa. Las **estadísticas** solo con el partido en marcha. La **forma reciente** y el **historial** están desde antes, y son lo único que sostiene el panel hasta esa hora. (La primera medición —«vacía a 87 y a 73 minutos»— se hizo a través de `lang=es`, que nunca devuelve el once: no dice nada sobre cuándo lo publica ESPN.)
- Como las predicciones cierran 15 min antes, queda una ventana real de **~45 minutos** para ver el once y corregir. Ese es el valor: por eso el panel va **antes** de las predicciones del grupo.
- **ESPN devuelve el plantel completo con `starter: false` hasta que publica el equipo.** Un recorte ingenuo mostraría 20 «titulares» que nadie anunció, y alguien predeciría con eso. `_alineaciones` descarta el equipo sin once.
- **Sin cuotas de apuestas** (decisión del dueño) y **sin «noticias»**: las de ESPN son de la LIGA, no del partido —en el resumen del Real Madrid venían previas de Porto–City—, así que mostrarlas ahí sería mentir. Hay una prueba que recorre el JSON entero buscando `odds`/`cuota`/`pickcenter` para que no vuelvan por una sección nueva.
- **La caché va en tabla aparte, NO en dos columnas de `matches`**: `GroupPage` hace `select('*')` sobre los partidos del torneo —144 en la Champions— así que un jsonb pegado ahí viajaría entero al navegador de todos, en cada carga, para una pantalla que ni lo usa.
- `match_details_cache` queda con **RLS activa y sin una sola política**: la escribe y la lee el backend con `service_role`; el cliente pide el detalle por el endpoint y nunca toca la tabla. Se puede vaciar entera sin perder nada.
- TTL por estado: 60 s en curso · 15 min por jugar · 24 h terminado. **Si ESPN no responde se sirve la copia vieja marcada como tal**: una alineación de hace diez minutos es más útil que una pantalla en blanco.
- El endpoint **exige sesión** aunque el dato sea público: si no, cualquiera podría usarlo para pegarle a ESPN a través nuestro. Es la lección de `/refresh-live`, que nació público.
- **No funciona en el Mundial 2026**: es el único torneo sin `external_id` (usa su propio sync). Se dice en pantalla, en vez de dejar un vacío que parezca un fallo.
- **La alineación se dibuja sobre una CANCHA, no en una lista.** Una formación es información espacial: «4-2-3-1» en una lista son cuatro números; sobre el campo se ve si el rival juega con tres delanteros o se encierra. `CanchaAlineacion.jsx`.
- **El 3D es CSS (`perspective` + `rotateX`), no una librería.** Un motor 3D serían cientos de KB en una pantalla que se abre desde el celular con datos, y **el CSP solo permite scripts propios**: una librería por CDN la bloquearía el navegador. Las fichas se enderezan con un `rotateX` inverso — un jugador tumbado sobre el césped se ve bien en una captura y no se lee en la mano.
- **Una pestaña por equipo, no dos canchas.** Dos canchas en un celular dejan fichas de 30 px con el nombre ilegible.
- **`_historial` leía `summary`/`shortName`, que `seasonseries` NO trae**: la pantalla mostraba la fecha y nada más. El marcador está en `competitors`, uno por equipo con su `score`. Lo reportó el dueño.
- **Cerca del saque la respuesta dura menos** (3 min en vez de 15): la alineación es justo lo que está por aparecer, así que cachearla un cuarto de hora la deja vieja todo ese rato.
- **Cuando todavía no hay once se DICE por qué y cuándo.** Que la tarjeta falte se lee como «esta app no tiene alineaciones»; el dato es que aún no salieron.
- **NADA de `lang=es&region=es` en la petición a ESPN, aunque la app esté en español.** La edición en español **no trae la alineación**: medido el 9 sep 2026 sobre Barcelona–Feyenoord y Stuttgart–Viking, a 28 min del saque y con el once ya publicado, la MISMA petición devuelve 11 titulares y formación sin `lang`, y **0 titulares y formación `None`** con él. Como `_alineaciones` descarta —bien— al equipo sin once, el panel decía «todavía no se publicaron» **para siempre**: nunca llegó a enseñar una alineación desde que se publicó. Lo reportó el dueño; ninguna prueba podía verlo porque los fixtures se habían capturado con el mismo parámetro puesto.
- Lo único que se pierde es el idioma de las etiquetas: `gameResult` pasa a venir **W/L/D** en vez de G/P/E. Se traduce en `_forma` (`_RESULTADO`), por lo mismo que las etiquetas de las estadísticas — la pantalla solo entiende G/P/E y pinta un punto gris para lo demás, así que sin traducir, arreglar la alineación habría dejado «Cómo vienen» en cinco puntos grises. Un valor desconocido queda en `None`, no se inventa un resultado.
- `PARAMS_ESPN` existe para poder **candar el parámetro en una prueba**; `espn_summary_once_publicado.json` es la respuesta real con el once, para que el caso que el panel nunca pudo mostrar quede fijado. Comprobado que las dos pruebas caen al devolver `lang=es` y al dejar de traducir.
- **Un fixture capturado a través del bug no prueba nada.** `espn_summary_por_jugar.json` venía de una respuesta con `lang=es`, así que «sin once publicado» y «con el parámetro roto» se veían idénticos.
- **La caché es una mejora, NO una dependencia.** Se mergeó el código antes de aplicar la migración, la tabla no existía, la lectura reventó sin `try` y el endpoint devolvió **500** en producción. La escritura sí estaba protegida; la lectura no. Ahora un fallo de caché se registra y se sigue: se le pregunta a ESPN igual. **Regla**: al agregar una migración y el código que la usa, o sale la migración primero, o el código aguanta sin ella.
- Los fixtures de las pruebas son respuestas **reales** de ESPN adelgazadas, y viven **en el repo** (`backend/tests/datos/`, `frontend/tests/ui/datos/`): en una carpeta temporal la prueba pasa en local y CI no encuentra el archivo.

## El cron vive en la BASE, no en GitHub (migración `database/79_cron_en_la_base.sql`)
- **Medido, y por eso se movió**: `sync-live-scores.yml` decía `*/5` y las últimas 100 corridas dieron **100 en 327 h — 2.5% de la cobertura esperada**, arrastrándose desde el 26 de agosto. El recordatorio de 45 min, ~8%. El resumen «de las 6 am» se vio corriendo a las 15:05 UTC. GitHub no garantiza la puntualidad de `schedule` y no hay nada que ajustar de nuestro lado.
- El síntoma que lo destapó: un partido **en curso** mostraba «PROGRAMADO». ESPN ya lo tenía en vivo; nosotros no lo habíamos escrito.
- Ahora lo dispara **pg_cron**: `sync-en-vivo` cada minuto, `recordatorio-saque` cada 15, `resumen-diario` a las 12:00 UTC (6 am de Costa Rica, que es UTC-6 todo el año).
- **Solo llama si hay algo que hacer, y «algo» incluye que el torneo TENGA QUINIELA.** Medido: LaLiga y Premier tienen 10 partidos cada una en las próximas dos semanas y **ninguna quiniela** — sin ese filtro estaríamos llamando a ESPN por torneos que nadie juega. Es el mismo criterio que ya usaba `sync_all_espn_tournaments`.
- **El secreto va en Vault, cifrado, no en una tabla.** Una tabla plana la lee cualquiera con acceso a la base, y ese secreto abre endpoints que escriben. Se carga a mano (`vault.create_secret`); la migración no lo trae ni podría.
- **Los `schedule:` de GitHub quedaron apagados, pero los archivos NO se borraron**: `workflow_dispatch` sirve para disparar a mano si la base no puede. Con los dos activos el recordatorio **se solapa y manda avisos repetidos** — es el fallo que este mismo archivo ya tenía anotado como pendiente.
- Con pg_cron la cadencia sí es la nominal, que es justo lo que la ventana `[45, 60)` del recordatorio necesitaba para no solaparse ni dejar huecos. **Sigue pendiente** la deduplicación persistente: protege de atrasos y reintentos, que una cadencia fiable hace raros pero no imposibles.
- `cron.schedule` con un nombre que ya existe lo **reemplaza**, así que volver a correr la migración no duplica tareas.
## El paquete del backend pesa la mitad
- Vercel avisó al **75% de los 10 GB de Function Storage**. Ese storage es **acumulado**: cada despliegue guarda su propio paquete de funciones.
- **Medido, no supuesto**: con los extras `[standard]` el paquete pesa **147 MB**; sin ellos, **93 MB**. Son **54 MB por despliegue**. `uvloop` solo son 14 MB.
- `fastapi[standard]` y `uvicorn[standard]` arrastran uvloop, httptools, watchfiles, rich, typer, fastapi-cli, jinja2, email-validator y python-multipart. **Ninguno se importa en `app/`** — comprobado leyendo los imports, y en Vercel el runtime habla ASGI directo, así que tampoco hace falta un servidor.
- `uvicorn` se movió a **`requirements-dev.txt`** (que incluye `-r requirements.txt`): sigue disponible para levantar la API en local, no viaja al despliegue.
- `PyJWT[cryptography]` **no existe como extra** —pip avisaba «does not provide the extra»— y los tokens de Supabase se verifican con **HS256**, que no lo necesita. `cryptography` llega igual con pywebpush.
- `test_dependencias_livianas.py` lo sujeta: prohíbe `[standard]` en producción, exige que uvicorn siga en dev, y mira `sys.modules` **después** de importar la app para cazar un `import` nuevo aunque la dependencia esté declarada. Comprobado que **falla en un entorno con los extras y pasa sin ellos**.
- **`websockets` NO es prescindible**: lo usa `supabase` para realtime. Lo incluí en la lista de pesadas por suponer y la propia prueba lo cazó.
- **Lo que el código no puede arreglar**: el storage ya consumido es de los despliegues viejos que Vercel conserva. Borrarlos es una acción de la cuenta, no del repo.

## Despliegue
- **Vercel** despliega frontend Y backend juntos en cada push a `main` (root `vercel.json` → `experimentalServices`, backend `@vercel/python` bajo `/_backend`).
- Cron de marcadores, recordatorio y resumen diario: **pg_cron en la base** (migración 79). Los workflows de GitHub
  siguen existiendo pero **sin `schedule:`**, solo para dispararlos a mano.
- Migraciones SQL: el admin las corre a mano en el SQL Editor de Supabase (archivos en `database/`).

## Al cambiar reglas de puntaje
1. Cambiar **ambos** motores (`scoring.js` y `scoring.py`) para que coincidan.
2. Actualizar la tarjeta correspondiente en `frontend/src/pages/RulesPage.jsx`.
3. Avisar al grupo. Si hay partidos ya puntuados con la regla vieja, recalcular (`recalc-scores`).
