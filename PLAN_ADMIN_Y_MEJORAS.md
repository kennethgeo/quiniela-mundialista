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

## El diagnóstico

La separación Admin / Reglas **ya está diseñada y documentada, y se ejecutó al
5%**. El `CLAUDE.md` dice por qué existe: Reglas la ve todo el grupo porque
«reglas y pozo son material de confianza», y las **acciones** van aparte «para
que la mayoría no vea botones que no puede usar».

Lo que hay hoy, medido:

- **Pestaña Admin** (`GroupPage.jsx:529-532`): monta **solo**
  `<PanelAdminQuiniela>`, con dos acciones — mandar el push de los partidos de
  hoy y compartir la imagen PNG del día.
- **Pestaña Reglas** (`GroupPage.jsx:534-544`), que ve todo el grupo: el resto
  entero de la configuración. `RulesPanel` (que dentro trae `RuleVoting`,
  `ScoringConfig`, `CuposPorFase`, `ExtrasConfig`, `ProposalHistory`,
  `AdminTools` y `DangerZone`), más `PozoYPagos`, `MiembrosYAdmins` e
  `HistorialAjustes`.

O sea: no falta una pestaña. **La que existe está vacía**, y toda la
configuración quedó en la pantalla del grupo con un `isAdmin &&` metido en
línea.

## Lo que hoy miente

### 1. Un texto que manda a un sitio al que no se puede entrar

`GroupPage.jsx:913` le dice a un admin de quiniela:

> «Si cambiás el puntaje con partidos ya jugados, corré "Recalcular puntajes"
> en el Panel Admin para re-puntuar con las nuevas reglas.»

Tres errores a la vez, comprobados:

- **El botón no se llama así.** Es «Recalcular puntos (eliminatoria)»
  (`RecalcScoresAdmin.jsx:48`).
- **No está en el panel de la quiniela.** Está en `/admin`, el panel GLOBAL. Lo
  que sí hay en «Herramientas» de Reglas es «Recalcular **medallas**»
  (`AdminTools`, `GroupPage.jsx:1073`), que es otra cosa.
- **Solo cubre partidos de eliminatoria**, no el puntaje entero: el endpoint
  filtra `.neq("phase", "groups")` (`admin.py:711`).
- **Y la premisa de fondo es falsa**: `set_group_scoring` **no vuelve a puntuar
  nada** — comprobado leyendo la función en producción. Cambiar el puntaje deja
  lo ya jugado con los puntos de las reglas viejas, y no hay ningún botón en la
  app que arregle la fase regular.

Y desde el 21 de septiembre está **peor**: al agregar `AdminRoute`, un admin de
quiniela que antes podía al menos abrir `/admin` y buscar el botón, ahora
recibe una redirección. Una instrucción confusa pasó a ser imposible.

**ARREGLADO el 21 sep 2026.** Ahora dice lo único que es cierto: «cambiar el
puntaje **no vuelve a puntuar** los partidos ya jugados — conservan los puntos
que sacaron con las reglas viejas. Re-puntuarlos es cosa del admin de la app.»

**Queda un hueco de producto, distinto de este texto**: no existe ninguna vía
en la interfaz para re-puntuar la **fase regular** de una quiniela tras un
cambio de puntaje. El endpoint que sí lo haría (`matches.py:23`, sin filtro de
fase) está protegido con `CRON_SECRET` y no lo llama ninguna pantalla. Es
candidato para la pestaña de Admin.

### 2. El candado del puntaje solo se le explica a quien no lo necesita

En `ScoringConfig` (`GroupPage.jsx:806+`), el cartel que explica el bloqueo

> «El torneo ya inició: el puntaje queda bloqueado. Para cambiarlo, proponé el
> cambio y el grupo lo vota.»

está detrás de `{isAdmin && propose …}`. Un miembro normal ve los números del
puntaje **sin ninguna pista** de que están bloqueados ni de que se cambian
votando — y es justo la persona que va a votar.

**ARREGLADO el 21 sep 2026.** El hecho lo lee todo el grupo; lo que cambia es
la redacción según a quién le toca actuar («proponé el cambio» para el admin,
«un admin tiene que proponerlo» para el resto).

## La arquitectura que propongo

El encuadre equivocado sería preguntar «¿qué bloques muevo a Admin?». Eso
obliga a elegir entre transparencia y orden, y en una quiniela por plata la
transparencia gana siempre.

La línea correcta es otra: **cada bloque tiene una AFIRMACIÓN y un CONTROL, y
son dos cosas distintas**. No se mueve el bloque; se parte.

| Bloque | **Reglas** (todo el grupo) | **Admin** (quien administra) |
|---|---|---|
| Puntaje | «Exacto 3 · Correcto 1 · ×2 duplica», y por qué está bloqueado | los campos editables |
| Cupos de ×2 | «Fase de liga 3 · Final 1» | el editor por fase |
| Pozo | cuota, quién pagó, cómo se reparte | fijar cuota, confirmar pagos |
| Miembros | quiénes son y **quién administra** | nombrar/quitar admin, expulsar |
| Votaciones | la votación abierta y el historial | proponer, cancelar |
| Acciones del día | — | push del día, imagen PNG |
| Herramientas | — | recalcular medallas |
| Zona de peligro | — | borrar la quiniela (**solo el creador**) |

Resultado: **Reglas queda sin un solo botón muerto** y responde «¿cuáles son
las reglas acá?». **Admin** responde «¿qué puedo cambiar yo, y qué pasa si lo
cambio?». Nadie pierde visibilidad de nada.

## Cómo comunicar los poderes

Una tarjeta **«Tu rol»** arriba de Admin. No un tooltip: tiene que verse sin
buscarla. Tres estados reales, que salen del modelo de las migraciones 59 y 66:

- **Creador** — todo, más nombrar admins y borrar la quiniela.
- **Co-admin** — todo menos esas dos.
- **Admin global mirando** — cartel distinto: «estás viendo como dueño de la
  app, no como miembro de esta quiniela: ves todo, pero no votás ni pagás ni
  aceptás reglas por nadie».

Y tres límites que hay que **explicar, no solo prohibir**. Este repo ya prefiere
dar el motivo:

- **No editás resultados de partidos.** Los partidos son compartidos con las
  demás quinielas del mismo torneo, así que los toca el admin global.
- **Una fase ya empezada no la cambiás solo.** Cambiar cuánto vale algo con la
  tabla a la vista es hacer trampa. Se propone y el grupo vota. Una fase que
  **no** empezó sí se configura directo (migraciones 74 y 75).
- **No confirmás tu propio pago**, ni siendo el creador.

## Lo que NO haría

- **No sacar el pozo de la vista del grupo.** Es lo primero que uno querría
  «ordenar» y sería el peor cambio posible: esconder quién pagó genera
  exactamente la desconfianza que la app existe para evitar.
- **No construir un sistema genérico de permisos.** Son 3 roles y ~10 acciones.
  Un mapa explícito se lee mejor que una abstracción, y `es_admin_liga` ya es la
  fuente de verdad en el servidor.
- **No confiar el permiso a la pantalla.** Esconder un botón es cosmética; quien
  manda es la RPC, y ya lo comprueba. Todo esto es presentación, no seguridad —
  y conviene decirlo así en el PR, para que nadie crea que se endureció algo.

## Orden

1. ~~**Arreglar los dos textos que mienten.**~~ ✅ **HECHO** (21 sep 2026).
   `reglas-que-se-entienden.spec.js`, 5 pruebas, comprobadas a la contra.
2. **La tarjeta «Tu rol»** en Admin. No depende de mover nada.
3. **Mover los controles** a Admin dejando las afirmaciones en Reglas, **un
   bloque por PR**. Empezar por Puntaje y Cupos, que son los que más confunden.
4. Pulido: blancos de toque, contraste, y que Admin abra mostrando algo útil.

---

# Parte 2 — Mejoras visuales

Ordenadas por lo que de verdad estorba, no por lo que se ve lindo en una
captura. Casi todas salen de mediciones que ya están en el `CLAUDE.md`.

## 2.1 El sistema de diseño está a medias, y se nota

Medido el 21 sep 2026 sobre el repo:

| | |
|---|---|
| `<button>` escritos a mano | **160** |
| Imports del componente `Button` | **3** |
| Usos de `glass-card` | 34 |
| Colores hexadecimales en el frontend | **947** |

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

**Opciones**: que se encoja al hacer scroll, que se esconda mientras se baja y
vuelva al subir, o reservarle sitio con padding al final de cada pantalla. Lo
que no vale es seguir esquivándolo tarjeta por tarjeta.

## 2.3 El spinner es de pantalla completa

`LoadingSpinner` es `fixed inset-0` con velo. Cada carga tapa **toda** la app,
incluida la navegación. En una pantalla que ya está dibujada y solo refresca un
bloque, eso se siente como si la app se reiniciara.

**Propuesta**: esqueletos por bloque para las recargas, y el de pantalla
completa solo para el arranque.

## 2.4 La escala tipográfica es una decisión pendiente del dueño

Hay **62 textos a 9 y 9.5 px**. Eso no es un fallo suelto: es la escala de la
app. Subirla es una decisión de diseño, no un arreglo — pero conviene tomarla,
porque el grupo son 26 personas de edades variadas.

Una alternativa menos invasiva: un ajuste de «texto más grande» en el Perfil que
escale la raíz. Cuesta poco si primero existen los tokens de 2.1.

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
