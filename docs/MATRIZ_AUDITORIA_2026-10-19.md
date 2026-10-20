# Auditoría de Claude: estado después del PR #205

Referencia del código integrado: `8d59b16` (PR #205) y `5f03723` (PR #206, integrado el 19–20 oct). El PR #207 (Claude) corrige en frontend Cara a cara, globales y estados, y bloquea el borrado de partidos. «Corregido en frontend» no significa SQL aplicado: la 109, la 110 y la RPC de cruces siguen sin aplicar. No confundir una corrección de frontend con la aplicación de SQL.

Claude consultó Supabase desde su app y confirmó migraciones hasta la 108. Es una observación del 19 de octubre: volver a comprobar el esquema antes de desplegar. Esta matriz no contiene ni reemplaza un respaldo de datos.

| Hallazgo de la revisión de Claude | Estado al preparar esta entrega | Evidencia y próximo paso |
| --- | --- | --- |
| Lecturas cortadas en 1.000 filas | Corregido en frontend (PR #205 + PR #207) | PR #205 pagina perfil e Histórico. PR #207: `CaraACara.jsx` usa `leerTodasLasFilas` filtrado por quiniela, las dos personas y los partidos jugados, con clave de caché propia y `.retry(false)`; sin lectura completa no muestra cifras. Ver `COORDINACION_CLAUDE_2026-10-19.md`. |
| Confirmación de abonos con cuatro argumentos | Corregido en PR #206 | La 110 exige `p_aviso_visto`, sin valor por defecto. Se envía el monto vigente o `null`, tanto al confirmar el aviso como al registrar otro monto. Los casos de interfaz verifican el cuerpo y el rechazo sin escritura alternativa. |
| Historial inexistente o incompatible antes de 110 | Corregido en PR #206 | Detectar tabla ausente; no prometer bitácora sin comprobarla. Con solo la 109, no seleccionar `monto_total`. El fallo temporal permite reintentar y no se interpreta como tabla inexistente. |
| Migraciones 109/110 pendientes | Pendiente de base y despliegue | Inspección de esquema, privilegios/triggers, respaldo/restauración y ventana actual de partidos. Frontend compatible antes de habilitar abonos. No se aplican en PR #205/#206. |
| Destape y reapertura no coinciden con RLS | Corregido en frontend (PR #207); la 109 sigue sin aplicar | `matchStatus` devuelve editable para `in_progress` con apertura forzada y para `pending` ya destapado con saque futuro. La rama forzada de 105/109 exige `pending`; la normal de 109 exige `destapado_at IS NULL`. Actualizar también expectativas antiguas que prueban reapertura en vivo. PR #207: reabierto solo con `pending`, destapado = cerrado, el checkbox del admin solo con Pendiente y «Me falta predecir» trae los reabiertos y excluye destapados. Contrastado con la RLS de producción del 20 oct (rama normal SIN `in_progress` hasta la 109). |
| Fallo de lectura de globales deja guardar vacío | Corregido en frontend (PR #207) | `TournamentGlobalCard` ignora errores de sus lecturas y permite upsert con campos vacíos. Diferenciar vacío confirmado de lectura fallida; conservar el borrador y bloquear guardado mientras no se conoce lo existente. PR #207: error visible con reintento, sin formulario ni upsert; el campeón guardado se ve aunque ESPN no lo liste; editor con `key` por cuenta/quiniela/torneo. |
| Cierre de globales usa solo predictions_locked | Corregido en frontend (PR #207) | Contrastar `TournamentGlobalCard` y `AllGlobalPicks` con `tournament_predictions_open` y la fila real de cada torneo. No deducir permisos únicamente del switch del admin. PR #207: tarjeta y lista llaman a la RPC; resultado no booleano o error = no se ofrece guardar. |
| Votación de cupos/asistidor muestra sin cambios | Integrado en PR #205 | `cambiosPuntaje` incluye cupos por fase, alta/baja, cero, asistidor y vuelta a cupo fijo. No rehacer esa lógica sin un caso que falle sobre main actualizado. |
| LLENAR pisa picks o guarda ceros sin confirmar | Integrado en PR #205, con límite explícito | Lectura inicial requerida, rechazo visible, borrador conservado, ceros nuevos confirmados y penales válidos. La selección de filas tocadas es una decisión de producto separada; no se afirma que esté implementada. |
| Gestión del pozo con aviso pendiente, redondeos y pérdida de importes | Corregido en PR #206 | Gestión manual con aviso visto, borradores por modo y validación de suma decimal. Pendiente verificar contra la RPC real una vez habilitada, sin modificar pagos reales como ensayo. |
| Cancelar editor de puntaje conserva cambios | Pendiente (no tocado en PR #207) | `ScoringConfig` en `GroupPage.jsx` conserva `cfg` al cerrar con `setEditing(false)`. Revisar cancelar frente a cambiar de pestaña: este último sí debe conservar borradores. |
| delete-match borra predicciones en cascada sin guardas | Contenido en PR #207 (bloqueado); desbloqueo pendiente | El endpoint responde 409 sin abrir el cliente de Supabase y el botón del panel está deshabilitado con la alternativa (Suspendido / No disputado). No es un borrado protegido: no hay borrado. Desbloquear exige una vía atómica desplegada que preserve todas las dependencias de `matches` (6 CASCADE + 1 SET NULL), con respaldo restaurable. Una FK RESTRICT propuesta no cuenta como protección activa. |
| Exactos y efectividad del perfil | Integrado en PR #205 | Exactos comparan goles; efectividad cuenta finalizados; estadísticas globales deduplican partidos. El motor de puntaje continúa solo en backend. |
| Humo/CI y contratos de base | Parcial, pendiente (no tocado en PR #207) | PR #206 cubre los cinco argumentos y esquemas ficticios 108/109/110. Esto no valida RLS ni triggers reales. No ejecutar la antigua humo sobre pagos/avatares reales para obtener un check verde. |

## Otros pendientes que siguen separados

- RPC de cruces: `docs/sql/actualizar_equipos_cruce.propuesta.sql` pasó pruebas sintéticas de PostgreSQL, no la interacción completa con producción/PostgREST. Sin función, el endpoint rechaza el guardado. Revisar, registrar migración y preparar respaldo/restauración antes de habilitarla.
- ~~Cara a cara para admin global no miembro~~ · corregido en PR #207: sin fila propia en la Tabla no se ofrece el duelo, y el componente no calcula sin las dos personas.
- Recalc-match: revisar que un resultado de error del motor no termine presentado como `status: ok`.
- Respaldo semanal: `scripts/respaldo/consultas.sql` enumera columnas de partidos y no incluye `destapado_at`; la lista explícita de torneos también requiere contrastarse con el esquema vigente. El MD semanal no certifica por sí solo una restauración completa del esquema.
- Voto después de votar, errores próximos a la fila y presentación de dólares: revalidar sobre main antes de tratarlos como arreglados.
- Simulador, chat por grupo, titularidad y política de aportes/devoluciones: contratos y decisiones en `EVOLUCION_PARTICIPACION_2026-10-16.md`; sin implementación nueva en estas entregas.

## Orden de integración

1. Revisar PR #206 y sus checks; integrar el frontend compatible sin aplicar SQL.
2. Revisar el PR de Claude sobre main actualizado, ejecutar sus regresiones y comprobar que no duplica ni revierte el #205/#206.
3. Para SQL, revalidar proyecto/esquema, ventana de partidos, respaldo privado restaurable y orden de despliegue; registrar exactamente lo ejecutado y comprobar invariantes. Una migración pendiente no se marca resuelta por hacer merge del frontend.
