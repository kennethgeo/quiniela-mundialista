# Coordinación Claude ↔ Codex — ronda del 19–20 oct 2026

Carril de Claude, asignado por Codex: Cara a cara, inspección del esquema real (sin aplicar SQL), globales, estados del partido y `delete-match`. El pozo (PR #206) fue de Codex y ya está integrado en `main` (`5f03723`); esta rama no lo toca.

Rama `claude/scroll-reach-fix-tq5ikg`, **PR #207**, sobre `main` en `5f03723` (comprobado: `main` contenido en la rama). **No se aplicó SQL en producción ni se escribió ningún dato**: todo lo que se ejecutó contra Supabase fue `SELECT` o lectura de catálogo.

## Lo que corrige el PR #207

| Tema | Commits | Qué cambia |
| --- | --- | --- |
| Cara a cara completo | `4dfe272`, `72e1b7a`, `3a55e64` | Lee con `leerTodasLasFilas` (conteo exacto, orden por id, avanza por lo recibido). Filtra por quiniela, las dos personas y los partidos jugados, con su propia clave de caché. `.retry(false)`: postgrest-js 2.107 reintenta internamente los GET con 503/520 (1, 2 y 4 s), y `retry: false` de React Query no lo apaga. Sin una lectura completa no hay cifras en la cabecera ni bloque de jornadas, solo el error con «Reintentar». Quien no tiene fila propia en la Tabla (el admin global que no juega) no recibe el botón, y el componente no calcula sin las dos personas. |
| Globales: cierre real | `4afa700` | La tarjeta y la lista preguntan a `tournament_predictions_open(p_tid)` en vez de a `tournaments.predictions_locked`. Si hay un error o el resultado no es booleano, no se ofrece guardar. |
| Globales: lectura fallida | `4afa700`, `4844bd1` | Si falla la lectura de lo guardado, se muestra un error con reintento, sin formulario ni upsert. El campeón guardado se ve aunque ESPN no lo liste (entra como opción). El editor lleva `key` por cuenta, quiniela y torneo. No se guarda mientras carga o mientras ya se está guardando. |
| Estados del partido | `0503735` | `reabierto` = `predictions_force_open` **y** `status = 'pending'`. Un partido destapado se ve cerrado aunque su saque sea futuro. En el panel, el checkbox de reabrir sale solo con Pendiente. «Me falta predecir» trae los reabiertos (`or(kickoff_at.gt…, predictions_force_open.is.true)`), pide `destapado_at` y excluye a los destapados. |
| Borrado de partidos | `cbce40e` | `/api/admin/delete-match` responde **409** sin abrir el cliente de Supabase. El botón del panel queda deshabilitado y explica la alternativa: marcar el partido «Suspendido / No disputado». No hay ningún DELETE de respaldo. |

Se corrigieron expectativas viejas **contra la RLS real**: las que pedían reapertura con el partido en vivo ahora esperan cerrado. No se conservaron para que pasara la suite.

## Pruebas

Corrida completa sobre el head del PR, 20 oct 2026:

- Backend: `pytest` **528 passed, 23 skipped**.
- Frontend:
  - `vitest` **407 passed** (38 archivos).
  - `eslint src tests public` **0 errores** (había 1 en mi `pendientes-reabiertos.spec.js`, corregido).
  - `npm run build` OK.
- Playwright: **299 passed** (escritorio y móvil).

### Pruebas nuevas

- `cara-a-cara-completo.spec.js`:
  - 600 partidos y 1.200 predicciones. El doble corta en 1.000 filas sin conteo y pagina de a 200 con conteo, así que la consulta vieja cae.
  - Un 503 en una página intermedia: no aparece ningún dígito y el reintento funciona.
  - El admin no miembro no recibe el botón y nada revienta.
- `globales-cierre-real.spec.js`:
  - Cerrado por la base aunque la columna diga abierto.
  - Lectura fallida sin escrituras.
  - Abierto: «Real Madrid» seleccionado y los tres campos en el upsert.
- `pendientes-reabiertos.spec.js`: el doble aplica `gt` y `or` como PostgREST.
- `reabrir-tarjeta.spec.js` y `admin-reabrir.spec.js`: ampliadas.
- `matchStatus.test.js`: ampliado.
- `backend/tests/test_delete_match_guarda.py`:
  - 409 sin tocar la base.
  - Sin admin, 401/403.

### Mutaciones comprobadas

Cada mutación se aplicó sobre una copia, se verificó que había quedado aplicada y el archivo se restauró con `cp` + `cmp`. Entre paréntesis, cuántas pruebas caen.

- **Cara a cara**:
  - lectura sin paginar (2);
  - botón sin la guarda de «yo» (1);
  - sin `.retry(false)` (1);
  - cifras sin lectura completa (1).
- **Globales**:
  - tarjeta vieja con `predictions_locked` (2);
  - lista vieja (1);
  - ignorar el error de la lectura propia (1);
  - sin la opción de respaldo del campeón (1).
- **Estados**:
  - reabrir en vivo (1);
  - sin `destapado_at` (2);
  - checkbox viejo (1);
  - consulta vieja del Hub (1).
- **Borrado**: volver a poner el DELETE (1).

## Evidencia de Supabase (solo lectura)

Proyecto `wifjwtbzstbuiistcxkf`; no se usaron otros proyectos.

### Lecturas de Claude, 19–20 oct 2026

- Migraciones hasta la 108. **La 109 y la 110 no están aplicadas**: no existe `confirmar_abono`. Tampoco existe `actualizar_equipos_cruce`.
- Políticas de escritura de `predictions`, leídas el 20 oct:
  - Rama normal: `kickoff_at - 15 min > now()`, `destapado_at IS NULL` y `status NOT IN (finished, cancelled, postponed)`. **No excluye `in_progress`** hasta la 109.
  - Rama forzada: `COALESCE(predictions_force_open, false) AND status = 'pending'`.
- `tournament_predictions_open(p_tid integer) → boolean` = `NOT predictions_locked AND (predictions_force_open OR now() < primer saque)`.
  - EXECUTE para `authenticated`, no para `anon`; está en el inventario de la 61.
  - Con `predictions_locked = true`, el forzado no reabre.
- Claves foráneas que apuntan a `matches` (`pg_constraint`):
  - CASCADE: `predictions`, `prediction_logs`, `match_audit`, `alertas_de_puntaje`, `notification_deliveries`, `match_details_cache`.
  - SET NULL: `powerup_credits.source_match_id`.
- Los 5 torneos tienen `source = 'espn'`.
- Ventana de partidos al cerrar esta ronda:
  - 307 a las 00:00 UTC del 20 oct (seguía `pending` a las 00:02);
  - 304 a las 02:00 UTC;
  - Champions a las 16:45 y a las 19:00 UTC.

### Evidencia independiente de Codex, 20 oct 2026, solo lectura

- Su conector lista el proyecto `wifjwtbzstbuiistcxkf`.
- `tournament_predictions_open` con `p_tid = 4`: HTTP 200, `false` (booleano).
- `HEAD` con `limit=0` sobre el filtro `or` nuevo de pendientes: HTTP 206, sin filas.
- La misma lista de FK de arriba.
- PostgreSQL 17.6, `read committed`.
- Triggers de `matches`: `marcar_destape`, `registrar_correccion_partido_trigger` y `resultado_cambiado_invalida_firma`.
- La RLS todavía no excluye `in_progress` en la rama normal.

## Pendientes explícitos (no los resuelve este PR ni su merge)

1. **Migraciones 109 y 110**.
   - Orden: frontend compatible (ya en `main` por el #206) → 109 → 110, con controles de solo lectura en producción. La humo corre solo en una copia aislada o con datos ficticios (escribe y borra). Plan: `docs/RESPALDO_RESTAURABLE_2026-10-20.md`.
   - Antes de aplicarlas:
     - ventana sin partidos comprobada en ese momento;
     - respaldo privado **restaurable** y probado;
     - inspección de esquema y privilegios del día;
     - validación completa sobre una copia aislada (humo incluida, nunca en producción).
   - La aplica el dueño: la confirmación de lo «destructivo» de la herramienta no llega a esta sesión y no se esquiva.
2. **RPC de cruces** (`docs/sql/actualizar_equipos_cruce.propuesta.sql`). Sigue siendo una propuesta probada en PostgreSQL 17 con un esquema sintético. Falta:
   - registrarla como migración;
   - ensayarla contra el esquema real y PostgREST;
   - tener un respaldo restaurable antes de activarla.

   Sin la función, el endpoint sigue respondiendo 503, sin UPDATE de respaldo.
3. **Desbloquear el borrado de partidos**. Requiere una vía **atómica y desplegada** (RPC transaccional que bloquee el partido y preserve o archive todas las dependencias de la lista de FK), probada con dos conexiones y con un respaldo restaurable. Una FK `RESTRICT` propuesta **no** cuenta como protección activa mientras no esté aplicada. Hasta entonces, el 409 se queda.
4. **Puntos de la matriz no tocados en esta ronda** (siguen pendientes):
   - `ScoringConfig`: «Cancelar» conserva los cambios.
   - Humo/CI contra RLS y triggers reales.
   - `recalc-match` puede presentar un error del motor como `status: ok`.
   - El respaldo semanal no incluye `destapado_at` y su lista de torneos está por contrastar.
   - Ocupado de `RuleVoting`, voto después de votar, errores junto a la fila y presentación en dólares (revalidar sobre `main`).
   - `verificar_estado.sql` sin `_aviso_de_pago_vigente`.
   - Guía de aplicación de migraciones.
   - Limpieza de WNS y miembros sin push.
   - Simulador, chat, titularidad y aportes (`EVOLUCION_PARTICIPACION_2026-10-16.md`).
5. **Regresiones del pozo**: carril de Codex.

## SQL ejecutado en esta ronda

Solo `SELECT` sobre tablas y catálogos del sistema (políticas, funciones, restricciones, triggers, migraciones registradas, partidos y torneos). Ningún INSERT, UPDATE, DELETE ni DDL.
