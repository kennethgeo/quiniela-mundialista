# Plan: la pestaña de Admin por quiniela, y hacia dónde va la app

Fecha: 2026-09-21 · Escrito después de medir sobre el código, no de memoria.

Este documento tiene dos mitades que se leen distinto:

- **Parte 1** es un plan concreto, con archivo y línea, listo para ejecutar.
- **Partes 2 y 3** son ideas ordenadas por valor. Son propuestas, no decisiones.
  Varias son del dueño desde hace meses; otras son mías y están marcadas como
  tales para que se puedan descartar sin discutir.

Nada de lo de acá reemplaza al `CLAUDE.md`. Si algo contradice ese archivo,
manda el `CLAUDE.md`: ahí está lo que ya se midió y lo que ya se rompió.

---

# Parte 1 — La pestaña de Admin por quiniela

## 0. Decisiones del dueño (21 sep 2026)

Estas cinco estaban bloqueando todo lo demás. **No son técnicas: son de producto
y de plata.** Las tomó el dueño y no se vuelven a discutir sin él.

| # | Decisión | Estado |
|---|---|---|
| 1 | La **propuesta** de cambio de puntaje deja elegir si se re-puntúa lo ya jugado | aprobada, sin prisa |
| 2 | Quien entra tarde paga **cuota completa**, con aviso previo de lo que implica | aprobada |
| 3 | El **padrón de una votación se congela** al abrirla | aprobada |
| 4 | El admin global **no manda el push** de una quiniela donde no es miembro | aprobada |
| 5 | **No se crea membresía hasta que la persona acepte** las reglas | aprobada |

### Lo que se midió antes de decidir

- **Cero propuestas en toda la historia de la app** (0 de cualquier tipo, 0 de
  puntaje, 0 abiertas hoy, 0 votos huérfanos). Las decisiones 1 y 3 protegen
  contra algo que **nunca ha pasado**.
- **Bundestica es la única con plata**: cuota ₡10.000 × 17 miembros =
  **₡170.000**. Champions (7 miembros) y Mundial 2026 (14, terminado) tienen
  cuota 0.
- **El admin global es miembro de las tres quinielas**, así que la decisión 4
  **no le quita ninguna capacidad hoy**.
- **9 membresías sin aceptar de 38**, las nueve en Mundial 2026 —terminado— y
  ninguna con una sola predicción. La decisión 5 arregla un flujo roto, pero
  **hoy no hay nadie atrapado en una quiniela por plata en curso**.

### Una limitación conocida y aceptada (decisión 1)

Dejar elegir la retroactividad en la propuesta es la mitad fácil. La otra mitad
—que «no retroactivo» **garantice** que un partido conserve sus reglas— exige
versionar las reglas con fecha de vigencia, porque hoy cualquier
re-sincronización de un partido viejo lo re-puntúa con la configuración actual
(`scoring.py` lee `leagues.points_exact` en el momento de calcular).

**Se acepta la limitación**: es el trabajo más caro de todo el plan y protege
contra un caso que no ha ocurrido nunca. Cuando alguien proponga de verdad un
cambio de puntaje, se retoma.

## 1. El diagnóstico

La separación Admin / Reglas **ya estaba diseñada y documentada, y se ejecutó al
5%**. El `CLAUDE.md` dice por qué existe: Reglas la ve todo el grupo porque
«reglas y pozo son material de confianza», y las acciones van aparte «para que
la mayoría no vea botones que no puede usar».

- **Pestaña Admin** (`GroupPage.jsx:529-532`): monta **solo**
  `<PanelAdminQuiniela>` — dos acciones.
- **Pestaña Reglas** (`GroupPage.jsx:534-543`), que ve todo el grupo: el resto
  entero de la configuración.

## 2. Bugs confirmados (verificados contra producción)

Cada uno comprobado leyendo el código o la base, no supuesto. Los marcados con
🔶 salieron de la auditoría externa y se verificaron acá.

| # | Qué | Dónde | Tipo |
|---|---|---|---|
| B1 🔶 | ~~«No acepto · salir» no saca a nadie~~ · **RESUELTO** con la salida voluntaria. Sigue pendiente lo de fondo (decisión 5): no insertar hasta aceptar | `GroupPage.jsx` | ✅ parcial |
| B2 🔶 | **`my_pending_vote` no exige membresía**: al admin global le dice «falta tu voto» y le pinta los botones; `cast_rule_vote` lo rechaza después | `quiniela_por_id` (la 76) | presentación |
| B3 🔶 | **El admin global puede mandar el push de una quiniela ajena** | `matches.py` (acepta `es_admin_global`) | autorización |
| B4 🔶 | **`PanelAdminQuiniela` afirma «Solo lo ven los administradores de esta quiniela»** y es falso | `PanelAdminQuiniela.jsx:85-88` | texto falso |
| B5 🔶 | **El pozo desaparece** para un miembro si no hay cuota configurada, en vez de decirlo | `PozoYPagos.jsx:74-76` | presentación |
| B6 🔶 | ~~**`expulsar_miembro` no borra los votos** y la mayoría usaba el conteo actual de miembros~~ · **RESUELTO** (migración 89): padrón fijo al abrir la votación, un solo conteo (`_conteo_votacion`) y bloqueo de la fila. Los votos de quien se va siguen contando, por decisión del dueño | votaciones | ✅ |
| B7 🔶 | **`MiembrosYAdmins` e `HistorialAjustes` fallan en silencio**: un error se ve como «0 miembros» o como una tarjeta ausente | los dos componentes | presentación |
| B8 🔶 | **El push manual no tiene deduplicación**: se puede repetir tantas veces como se pulse | `matches.py` (notify-daily-league) | comportamiento |
| B10 | **Salir o ser expulsado BORRA el historial de pagos** (viven en `league_members`) · mitigado en la 84 para la salida voluntaria; el arreglo de fondo —separar el pago de la membresía— sigue pendiente, y la EXPULSIÓN sigue borrándolo | `58_pozo_y_pagos.sql:31` | ⚠️ parcial |
| B11 | ~~**«Sync partidos» borraba partidos Y predicciones de temporadas anteriores**~~ · **RESUELTO**: solo borra los partidos que nadie predijo, contados partido por partido (el tope de 1.000 filas de PostgREST haría fallar una consulta única). Medido: hoy no habría borrado nada; mordía en julio de 2027 | `espn_tournament_sync.py` | ✅ |
| B12 | **La efectividad del Resumen usa TODAS las predicciones como denominador** y los aciertos solo de partidos terminados. Le da distinto a **19 de 24** | `GroupPage.jsx:1426-1432` | comportamiento |
| B13 | **El realtime refresca `['matches']`, que no consulta nadie**; `GroupPage` usa `['tournament_matches', tid]` | `useRealtime.js:16,27` | comportamiento |
| B14 | **Sin control de concurrencia**: dos admins con la config vieja abierta se pisan en silencio (los formularios mandan el objeto entero) | `leagues` sin `version` | comportamiento |
| B15 | **Errores de red se ven como datos vacíos**: «aún no tiene partidos», «sin miembros», estadísticas en cero | `GroupPage.jsx` varios | presentación |
| B16 | **`create_group` acepta torneos terminados** y las reglas por defecto dicen «al iniciar cada partido» cuando el cierre real es 15 min antes | `36_group_rules.sql` · `lib/groups.js:22-30` | comportamiento |
| B17 | **`/api/leagues` no tiene consumidores** y crea quinielas sin `tournament_id` que después no salen en el Hub | `main.py:36` · `routes/leagues.py` | código muerto |
| B18 🔶 | ~~**Cualquiera se auto-inscribía en cualquier quiniela como CO-ADMIN**, con las reglas aceptadas y su pago «confirmado»~~ · **RESUELTO** (migración 85). Explotado y revertido: `es_admin_liga = true` | `league_members` | ✅ 🔴 |
| B19 🔶 | ~~**Cada quien podía escribirse sus propios puntos**~~ (`43 → 10042` medido) · **RESUELTO** (migración 85) | `predictions.points_earned` | ✅ 🔴 |
| B20 🔶 | ~~**Las globales las leía `anon`**: 21 filas, 2 ligas, 17 personas, sin cuenta~~ · **RESUELTO** (migración 85) | `tournament_predictions` | ✅ 🔴 |
| B21 🔶 | ~~`recompute_user_total` corría la fórmula sin deduplicar (deriva: la 61 pisa a la 62)~~ · **RESUELTO** (migración 86). Desviación hoy: **0** | `recompute_user_total` | ✅ |
| B22 🔶 | ~~El crédito de ×2 se autorizaba con una bolsa y se cobraba con otra, y no se devolvía al apagarlo~~ · **RESUELTO** (migración 86) | `consume_powerup_credit` | ✅ |
| B23 | ~~Un puntaje que falla una vez no se reintenta nunca (`except: pass` + `changed=False`)~~ · **RESUELTO**. Medido: 0 partidos afectados hasta hoy | `espn_tournament_sync.py` | ✅ |
| B24 | ~~Tercera copia de la fórmula del total global, **sin el asistidor**, con botón que escribe~~ · **RESUELTO**: endpoint muerto borrado | `matches.py` (reconcile-totals) | ✅ |
| B25 | **Un DELETE directo saltaba el candado de pagos de la 84** · **RESUELTO** de paso por la 85. Lección: al proteger algo dentro de una RPC, mirar si la tabla se toca sin pasar por ella | `league_members` | ✅ |
| B26 | `users` conserva un GRANT de INSERT sobre `is_admin`/`total_points`/`points_adjustment` que **hoy no es alcanzable** (su única política de INSERT es `TO service_role`). Privilegio muerto que se vuelve agujero si alguien agrega una política | `users` | latente |
| B27 🔶 | ~~**La 85 rompió el guardado de predicciones**: PostgREST mete todas las columnas en el `DO UPDATE SET`~~ · **RESUELTO** (migración 87). Sin víctimas: 0 escrituras en la ventana rota | `predictions` · `tournament_predictions` | ✅ 🔴 |
| B28 🔶 | ~~Se podía guardar un partido de OTRO torneo en tu quiniela y sumaba~~ · **RESUELTO** (migración 87). 0 filas cruzadas | políticas de INSERT/UPDATE | ✅ |
| B29 🔶 | ~~Cambiar la cuota reescribía lo recaudado~~ · **RESUELTO** (migración 88) con monto por pago + candado. Los 13 pagos viejos se registraron con ₡10.000 por decisión del dueño, así que la cuota ya se puede cambiar sin reescribir lo pagado | `league_pozo` · `leagues` | ✅ |
| B30 🔶 | ~~El reintento de puntaje de la 86 buscaba NULL y la columna nace en 0: no-op~~ · **RESUELTO** con la firma del resultado (migración 88) | `scoring.py` | ✅ |
| B31 🔶 | ~~La puerta del cron no llamaba al backend para reintentar avisos~~ · **RESUELTO** (migración 88) | `cron_recordatorio_saque` | ✅ |
| B32 🔶 | ~~La 82 del repo no se podía ejecutar~~ · **RESUELTO** (solo el archivo; producción estaba bien) | `82_deduplicar_recordatorios.sql` | ✅ |
| B33 | ~~**Borrar la quiniela borraba la constancia de los 13 pagos**~~ · **RESUELTO** (migración 89): `delete_group` se niega con pagos confirmados | `delete_group` | ✅ 🔴 |
| B34 | ~~`leagues` escribible por el creador, cerrada solo de rebote por un CHECK~~ · **RESUELTO** (migración 89) | `leagues` | ✅ |
| B35 | ~~La firma de puntaje no cubría los partidos congelados~~ · **RESUELTO** | `espn_tournament_sync.py` | ✅ |
| B36 🔶 | ~~Una predicción cerrada se podía mudar de partido con sus puntos~~ · **RESUELTO** (migración 90, trigger de identidad) | `predictions` | ✅ 🔴 |
| B37 🔶 | ~~Reconfirmar un pago lo reescribía con la cuota nueva~~ · **RESUELTO** (migración 90) | `confirmar_pago` | ✅ 🔴 |
| B38 🔶 | ~~Dos recálculos cruzados dejaban puntos viejos con firma nueva~~ · **RESUELTO**: `aplicar_puntaje` atómico (migración 90) | `scoring.py` | ✅ |
| B39 🔶 | ~~Los push vencidos (404/410) nunca se reconocían~~ · **RESUELTO** | `notifications.py` | ✅ |
| B40 🔶 | ~~La prueba de humo podía dar verde sin probar~~ · **RESUELTO**: versión 2, 29 rutas con afirmaciones | `humo_rutas_del_cliente.sql` | ✅ |
| B41 🔶 | ~~El reintento de puntaje no es universal~~ · **RESUELTO** (migración 91): `puntuar_pendientes` recorre la BASE (terminados de los últimos 3 días sin firma de su resultado), sin depender de ESPN ni de otro partido en curso; la firma se borra sola al cambiar el resultado y `hay_puntajes_pendientes()` abre la puerta del rescate. Reproducido por Astra, cerrado con pruebas | `scoring.py` · `routes/matches.py` · `91_…sql` | ✅ |
| B42 🔶 | **El 9 de octubre (20:00 CR) hay 8 miembros sin predicción y NINGUNO con push**: el recordatorio no les va a llegar. No es un fallo del código: hay que invitarlos a activar las notificaciones | push_subscriptions | producto |
| B43 🔶 | ~~`aplicar_puntaje` firmaba lotes incompletos~~ · **RESUELTO** (91): exige exactamente las predicciones del partido, ids únicos y puntos enteros ≥ 0; si no, `incompleto` sin escribir. Lectura paginada en el backend | `91_…sql` · `scoring.py` | ✅ |
| B44 🔶 | ~~Confirmar un pago se podía cruzar con salir o borrar la quiniela~~ · **RESUELTO** (91): protocolo de bloqueos. Reproducido con dos conexiones en Postgres local: antes el pago confirmado desaparecía, ahora se rechaza la salida/el borrado | `91_…sql` | ✅ |
| B45 🔶 | ~~Limpiar un push vencido podía reenviar el aviso a quien ya lo recibió~~ · **RESUELTO**: la limpieza ya no tumba el resultado del envío | `notifications.py` | ✅ |
| B46 🔶 | ~~El anuncio global NO se podía guardar nunca~~ · **RESUELTO** (91): faltaba la política de INSERT que exige el upsert. Lo destapó la humo v3, no la auditoría | `91_…sql` | ✅ |
| B47 🔶 | ~~La humo v2 daba verde con escrituras que no hacían nada~~ · **RESUELTO**: versión 3, 34 rutas; valores distintos y afirmados, `RETURNING *`, lecturas contra lo esperado, tablas directas y admin global. Comprobado que cae con `set_group_extras`/`set_powerup_limits` vacías | `humo_rutas_del_cliente.sql` | ✅ |
| B48 🔶 | ~~Borrar una cuenta borraba sus pagos~~ · **RESUELTO** (92): trigger en `league_members` + comprobación previa en `delete-user`. Reproducido con dos conexiones | `92_…sql` · `routes/admin.py` | ✅ |
| B49 🔶 | ~~Anular/restaurar, predicciones tardías y correcciones viejas escapaban a la recuperación~~ · **RESUELTO** (92): el estado invalida la firma, `anulado` como firma, `modificada_at`/`puntuado_at`, ventana desde que quedó pendiente, lista única en SQL | `92_…sql` · `scoring.py` | ✅ |
| B50 🔶 | ~~Salir y expulsar podían trabarse (deadlock)~~ · **RESUELTO** (92): mismo orden de bloqueos | `92_…sql` | ✅ |
| B51 🔶 | **`void_cancelled_match` también está escrita en la 61**: volver a correrla pisaría la versión de la 92 (y la de la 73) | `61_endurecer_permisos.sql:161` | latente |
| B52 🔶 | **26 cuentas en `auth.users`, 24 perfiles en `public.users`**: dos cuentas sin perfil, sin explicar | auth.users | por mirar |
| B9 | ~~No existe ninguna salida voluntaria~~ · **RESUELTO** (migración 83, 21 sep 2026): `salir_de_quiniela` + aviso con números. B1 se resuelve de paso: «No acepto · salir» ahora sale de verdad | `83_salida_voluntaria.sql` | ✅ |

## 3. La arquitectura

El encuadre equivocado sería «¿qué bloques muevo a Admin?». Eso obliga a elegir
entre transparencia y orden, y en una quiniela por plata gana la transparencia.

**La regla correcta** (corregida tras la auditoría externa, que tenía razón):

> **Reglas** contiene el contrato compartido **y las acciones personales o
> colectivas**. **Admin** contiene exclusivamente **controles administrativos**.

El objetivo NO es «Reglas sin botones» — votar, cancelar una propuesta y avisar
«Ya pagué» pertenecen al contexto compartido. El objetivo es **sin controles
administrativos fuera de contexto**.

| Bloque | **Reglas** (todo el grupo) | **Admin** (creador / co-admin) |
|---|---|---|
| Puntaje | valores vigentes y por qué está bloqueado | editar antes del inicio · proponer cambio |
| Cupos ×2 | cupo efectivo de cada fase — **hoy no existe esta lectura** | editor y propuesta |
| Pozo | cuota, reparto, pagos y **«Ya pagué»** | configurar · confirmar pagos ajenos |
| Miembros | lista con etiquetas de creador/co-admin | nombrar, quitar, expulsar |
| Votación abierta | propuesta, votos, **votar y cancelar** | crear una propuesta nueva |
| Premios / WhatsApp | visualización | edición |
| Imagen del día | ya está en Partidos | **quitar la copia duplicada** |
| Push manual | — | vista previa, confirmación, registro |
| Historial de ajustes | Histórico | — |
| Medallas | — | recalcular |
| Borrar quiniela | — | **solo el creador** |

Tres correcciones que vinieron de la auditoría y se adoptan: **«Cancelar
propuesta» se queda junto a la propuesta** (mandarlo a Admin obligaría a
abandonar la pantalla donde se ve qué se cancela y cuántos votaron), **«Ya
pagué» es una acción del miembro**, y **«compartir imagen» está duplicada** en
`PanelAdminQuiniela` y `PartidosDeHoy`.

## 4. La tarjeta «Tu rol»

Arriba de Admin, no un tooltip. **Nada de una tabla de tres columnas en móvil**:
un texto corto según quién sos.

- **Creador** — configurar, proponer, confirmar pagos ajenos, nombrar
  co-administradores y eliminar la quiniela. No podés confirmar tu propio pago
  ni editar resultados: los partidos se comparten con otras quinielas.
- **Co-admin** — lo mismo, menos nombrar admins y eliminar.
- **Admin global no miembro** — **no ve la pestaña Admin**. Conserva el cartel
  de supervisión: «podés consultar esta quiniela, pero no actuar como miembro ni
  como administrador del grupo».

## 5. Re-puntuación: lo que NO se hace

El motor actual (`scoring.py`) toma **todas las predicciones del partido, de
todas las quinielas**, aplica la configuración **actual** de cada una, y **manda
push** a quien suba. Verificado.

**Un botón de «recalcular» por quiniela sobre ese motor tocaría quinielas
ajenas y dispararía una notificación por partido.** Si alguna vez se hace, va
con: alcance por `league_id`, vista previa sin escrituras, delta por persona y
posiciones antes/después, registro de qué regla se aplicó y quién lo pidió,
trabajo idempotente, snapshot para revertir, **cero pushes por partido**, y
formar parte de lo que el grupo vota.

Las reparaciones por error técnico siguen en `/admin` global.

## 6. Orden de ejecución

La publicación puede ser una sola, en la ventana sin partidos hasta el 10 de
octubre. La implementación va en tandas revisables.

1. **Esquema y contratos, sin interfaz**: padrón congelado por propuesta, flag
   de retroactividad, idempotencia del push manual. ~~salida voluntaria~~ ✅
   hecha (migración 83, aplicada y verificada). **Toda
   RPC nueva que llame el frontend entra en `v_frontend` de la migración 61**, o
   se queda muda la próxima vez que se corra.
2. **Backend**: autorización del push (quitar `es_admin_global`), vista previa
   de invitación, ingreso atómico con aceptación.
3. **Primitivas visuales mínimas** — solo las que usará la pantalla nueva
   (`Card`, `Button`, `Input`, `Chip`, `StatePanel`, modal de confirmación y sus
   tokens). **Sin barrida masiva**: no hace falta convertir 156 botones ni 947
   colores para estrenar Admin.
4. **La arquitectura nueva**: Admin solo con `group.is_admin`, tarjeta de rol,
   controles administrativos; Reglas conserva contrato, voto y acciones
   personales.
5. **Flujo de ingreso**: vista previa, aceptación real, condiciones económicas
   visibles.
6. **Los bugs sueltos**: B2, B4, B5, B7.
7. **Validación** con las cuatro identidades (creador, co-admin, miembro, global
   no miembro), probando **visibilidad y llamada directa al servidor** — es fácil
   esconder el botón y dejar el endpoint abierto, o al revés.

**No se hace primero el rediseño y después el modelo de datos**: obligaría a
rehacer textos, estados y controles.

# Parte 2 — Mejoras visuales

Ordenadas por lo que de verdad estorba, no por lo que se ve lindo en una
captura. Casi todas salen de mediciones que ya están en el `CLAUDE.md`.

## 2.1 El sistema de diseño está a medias, y se nota

Medido sobre `main = 64ba004`. **El comando queda escrito para que el alcance
sea siempre el mismo**: una auditoría externa reportó 968/114 y la diferencia
era solo que contaba hex de 3 a 8 dígitos y cualquier archivo de `frontend/src`.
Con el comando de abajo da 947 exacto, y quien lo repita obtiene lo mismo.

| | | comando |
|---|---|---|
| `<button>` escritos a mano | **156** | `grep -rno '<button' frontend/src --include=*.jsx` |
| Imports del componente `Button` | **3** | |
| Usos de `glass-card` | 34 | |
| Hexadecimales (ocurrencias) | **947** | `grep -rnoE '#[0-9a-fA-F]{6}\b' frontend/src --include=*.jsx --include=*.js --include=*.css` |
| Hexadecimales (valores distintos) | **107** | el mismo, con `-h … \| sort -u` |
| Textos a 9 y 9.5 px | **63** | `grep -rnoE 'text-\[9(\.5)?px\]' frontend/src --include=*.jsx` |

**El 160 del primer borrador era correcto cuando se midió** y bajó a 156 con los
archivos que se borraron ese mismo día. Una medición sin fecha ni comando
envejece sola.

Ya existen `Button`, `StatePanel` y `MatchStatusBadge`. Falta consolidar
`Card`, `Modal`, `Input`, `Select`, `Chip`, `IconButton`, filas de tabla, y
tokens de color / radio / sombra.

**Por qué importa más de lo que parece**: con 947 hex sueltos, cada arreglo de
contraste es manual y se olvida. El acento de la app sobre su propio fondo al
12-14% da **1.6-1.7:1**, y ya apareció **dos veces** en producción — en el aviso
de notificaciones y en «Cómo vienen». Con tokens por tema, ese fallo deja de
poder ocurrir.

**Cómo**: por tandas chicas y con capturas. Nunca en un PR gigante.

## 2.2 El botón flotante del chat tapa contenido

Visible en las capturas del dueño: el FAB vive pegado abajo a la derecha y se
come la esquina de la tarjeta que esté ahí. Ya obligó a mover a la izquierda el
pie de «Cómo vienen».

El botón es de 56 px y va fijo (`GlobalChatDrawer.jsx:188-207`).

**El arreglo va en el armazón, no tarjeta por tarjeta ni escondiéndolo al
bajar**: un área segura común en `App.jsx` que reciba toda pantalla. Después se
mide a 412 px con la última acción de cada pestaña visible y pulsable.

## 2.3 El spinner es de pantalla completa

`LoadingSpinner` es `fixed inset-0` con velo. Cada carga tapa **toda** la app,
incluida la navegación. En una pantalla que ya está dibujada y solo refresca un
bloque, eso se siente como si la app se reiniciara.

**Dónde SÍ es correcto**: arranque, autenticación y carga de una ruta protegida.
**Dónde no**: dentro de una pestaña ya montada — `GroupPage.jsx:447`,
`BracketView.jsx:80`, `HistorialTab.jsx:179`. Ahí van esqueletos locales. No se
reemplazan todos los spinners indiscriminadamente.

## 2.4 La escala tipográfica es una decisión pendiente del dueño

Hay **63 textos a 9 y 9.5 px**. Eso no es un fallo suelto: es la escala de la
app. Subirla es una decisión de diseño, no un arreglo — pero conviene tomarla,
porque el grupo son 26 personas de edades variadas.

**Una idea que parecía barata y NO lo es**: un ajuste de «texto más grande» que
escale la raíz no haría nada, porque los 63 tamaños están en **px** y los px no
responden al tamaño de la raíz. Primero habría que pasarlos a tokens o `rem`.
Lo señaló la auditoría externa y tenía razón.

## 2.5 El tema claro es ciudadano de segunda

Los dos fallos de contraste que llegaron a producción fueron **en claro**. El
diseño se piensa en oscuro y el claro se comprueba después, o no se comprueba.

**Propuesta**: que las pruebas de contraste corran en **los dos temas** por
defecto para cualquier pantalla nueva, como ya hacen
`aviso-notificaciones.spec.js` y `detalle-partido.spec.js`.

## 2.6 Estados vacíos que expliquen

Ya se arregló en varios sitios («no hay enfrentamientos previos registrados»,
«todavía no nos llegó el resultado»). Falta barrer el resto: una tarjeta que
desaparece se lee como «esta app perdió el dato», y una lista vacía sin texto,
como que se rompió.

---

# Parte 3 — Funciones

## 3.1 Lo que el dueño ya pidió y sigue pendiente

Está en el `CLAUDE.md`; se repite acá para tenerlo junto.

1. Recordatorios configurables por persona y hora.
2. Suscripción de calendario que se **actualice** (hoy solo se descarga un `.ics`
   que nace viejo).
3. Resumen de jornada completo: mejor exacto, peor caída, mejor ×2, movimientos
   de posición.
4. Chat por quiniela, con silenciar y menciones.
5. Invitaciones con QR, vencimiento, revocación y uso único.
6. Pagos parciales, historial, CSV y recordatorios.
7. Simulador «si termina así».
8. Panel de salud: cron, migraciones, caché, sync y errores.
9. Borradores locales de predicciones y confirmación «Guardado a las…».
10. Explicación del cálculo de puntos por partido.
11. Pruebas reales en Safari iOS y con la PWA instalada.

## 3.2 Lo que yo agregaría

Todas estas salen de una misma observación: **la app guarda predicciones muy
bien y cuenta la historia muy poco**. Los datos para contarla ya están.

### El destape (alta)

Las predicciones se destapan 15 minutos antes del saque. Ese es el momento con
más tensión de toda la quiniela — «¿qué puso el resto?» — y hoy es una lista.

Una vista de **destape**: la grilla de lo que puso cada quien, con su marcador,
compartible a WhatsApp como imagen. La app ya sabe generar tarjetas PNG
(`shareCard.js`), así que la parte cara está hecha.

### La tabla en vivo (alta)

Durante los partidos: **cómo quedaría la tabla si el marcador actual se
mantuviera**. Es el «simulador» del punto 7, pero en el momento en que de verdad
importa. La tabla de Posiciones ya cuenta marcadores parciales; falta aplicar la
misma idea a la tabla de la quiniela.

### El cuento del partido (media)

Al terminar un partido, el grupo habla de tres cosas: quién la clavó, a quién se
le cayó, y quién se jugó el ×2 y le salió. Todo eso está en `points_earned`.

Una tarjeta de cierre por partido con eso, compartible. Incluido **el «casi»**:
quien falló por un gol. Es lo que más se comenta y hoy hay que deducirlo
mirando la matriz.

### «Qué me queda» (media)

Un bloque en el Resumen que responda lo que uno se pregunta de verdad:
cuántos ×2 te quedan en esta fase, cuántos puntos te separan del de arriba, y
qué tendría que pasar para alcanzarlo. Es el mismo motor del simulador,
enfocado en la persona.

### Onboarding de la quiniela (media)

Un miembro nuevo entra y ve números sin saber cuánto vale qué. Un ejemplo
trabajado —«predijiste 2-1, quedó 2-1: 3 puntos; quedó 3-1: 1 punto»— con las
reglas **de esa quiniela**, no las genéricas. Se conecta con el punto 10 de
arriba.

### Un push que sí se quiere recibir (baja, y con cuidado)

«Te pasaron en la tabla» es tentador y es justo el tipo de aviso que hace que la
gente apague **todas** las notificaciones — y ahí se pierden también el
recordatorio del saque y el resumen. Si se hace: **opt-in explícito**, nunca por
defecto, y como mucho una vez por jornada.

### El resumen de la temporada (baja, alto cariño)

Al cerrar un torneo: una imagen con el campeón de la quiniela, el mejor acierto,
la peor caída, la racha más larga y quién pagó. Es lo que se manda al grupo el
último día y lo que hace que al año siguiente todos vuelvan.

### Lo que pasa al entrar a mitad de temporada (alta)

Salió de la auditoría externa y el plan no lo veía. Hoy, cuando alguien entra:

- el pozo esperado sube solo (se calcula con los miembros **actuales**);
- esa persona aparece debiendo la cuota completa;
- arranca con 0 en todos los partidos cerrados;
- y **si hay una votación abierta, sube la mayoría necesaria**.

Nada de eso se le dice antes de entrar. Con la decisión 2 y la 5 tomadas, el
flujo nuevo tiene que **mostrarlo y pedir aceptación explícita**.

### Validar la deduplicación de recordatorios (alta, con fecha)

La migración 82 está aplicada y el código mergeado, pero `notification_deliveries`
tiene **0 filas** y no va a tener ninguna hasta el **10 de octubre**, que es el
próximo partido de un torneo con quiniela. Cero filas no demuestra ni éxito ni
fallo.

**No se "prueba" mandando notificaciones reales ahora.** Antes del 10 de
octubre: integración en una base aislada con dos reclamaciones concurrentes,
entrega parcial, reclamo vencido, usuario sin detalle y caída deliberada de la
RPC. El primer día real: una fila por `(user, league, match, tipo)`, transición
`claimed → delivered/failed`, cero duplicados y revisión del fallback.

Si algún día hay un panel de salud, **no puede decir «Correcto» con la tabla
vacía**: tiene que decir «sin ejecuciones reales todavía».

## 3.3 Lo que NO haría

- **Cuotas de apuestas.** Decisión del dueño, ya anotada.
- **Noticias de ESPN.** Son de la liga, no del partido: mostrarlas como noticias
  del partido sería mentir. Ya está probado que no vuelvan.
- **Cobrar o mover dinero dentro de la app.** Las condiciones dicen textual que
  la app lleva la cuenta del pozo pero **no cobra, no paga, no retiene ni
  transfiere**. Cambiar eso no es una función: es otro producto, con otras
  obligaciones legales.
- **Gamificación genérica** (niveles, rachas de ingreso, monedas). El grupo ya
  tiene la motivación resuelta: hay plata y hay amigos. Agregar una capa de
  puntos falsos encima abarata la de verdad.

---

# Cómo priorizar esto

Tres criterios, en este orden:

1. **¿Hoy miente?** Un texto que manda a una puerta cerrada o un número que no
   es el que la base aplica se arregla antes que cualquier función nueva. En una
   quiniela por plata, parecer correcto y no serlo es lo más caro que hay.
2. **¿Cuántos lo sufren y cuántas veces?** El destape lo viven 26 personas
   varias veces por semana. El editor de cupos lo toca un admin dos veces por
   temporada.
3. **¿Se puede mergear solo?** Si hace falta un PR de 2.000 líneas, está mal
   partido.

Y una regla que este repo se ganó a golpes: **medir antes de afirmar**. Varias
de las ideas de arriba van a resultar falsas cuando alguien las mire de cerca —
como pasó con «`scoring.js` es código residual», que era cierto a medias, o con
«el historial de migraciones está incompleto», que apuntaba al sitio equivocado.
Eso es normal. Lo que no vale es implementarlas sin comprobarlas.
