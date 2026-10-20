# Respaldo privado RESTAURABLE y ensayo de 109/110/RPC de cruces

20 oct 2026 · Claude, carril de backend/scripts. **No se ejecutó DDL ni DML en producción.**

> **Decisión del dueño, 20 oct 2026: «Continúa sin cambios de base de datos».** En esta ronda no se aplican la 109, la 110 ni la RPC de cruces, no hay limpieza de WNS ni ninguna otra escritura en producción, y **no se restauran datos privados de producción en un destino externo**. No hay `SUPABASE_DB_URL` configurada. Los ensayos se hacen solo en local y con datos ficticios. El procedimiento de abajo queda como plan para cuando el dueño lo habilite; no es una tarea de esta ronda. Todo lo que se corrió contra `wifjwtbzstbuiistcxkf` fue `SELECT` sobre catálogos, conteos y hashes, sin traer datos de personas.

## Por qué el MD semanal no alcanza

`scripts/respaldo` arma una foto legible de los datos de `public`. No trae:

- el esquema;
- las funciones, triggers, políticas ni permisos;
- Auth: `auth.users` (24) y `auth.identities` (27), con contraseñas en hash e identidades de Google;
- Storage: el bucket `avatars`, con 21 objetos;
- pg_cron (4 tareas) ni Vault (2 secretos).

Sin el esquema, el JSON no se puede cargar en ningún lado, y hoy no hay ninguna copia que se pueda **restaurar**. Para aplicar la 109, la 110 o la RPC de cruces hace falta un respaldo que se haya restaurado y verificado. No basta con uno que solo exista.

## Lo que hay hoy (medido el 20 oct, solo lectura)

| Dato | Valor |
| --- | --- |
| Postgres | 17.6 (`17.6.1.127`), región us-west-2 |
| Extensiones | pg_cron 1.6.4, pg_net 0.20.3, pg_stat_statements, pgcrypto, supabase_vault, unaccent, uuid-ossp |
| Tablas en `public` | 26: las del MD más `live_sync_state`; `historial_pagos` llegará con la 109 |
| Cron activo | `sync-en-vivo` (cada minuto), `recordatorio-saque` (cada 15 min), `rescate-de-resultados` (cada 30 min), `resumen-diario` (12:00 UTC) |
| Triggers sobre `auth.users` | `on_auth_user_created`, `on_auth_user_ban_check` |
| Huella | `scripts/respaldo/huella_por_tabla.sql` corre en producción (por ejemplo, `predictions` 1341 filas y `matches` 429) |

## Bloqueos concretos (no los resuelvo desde esta sesión)

1. **Credencial**: el dump necesita la contraseña de la base (conexión directa o *session pooler*). No está en esta sesión, no se pide por chat y no va al repositorio.
2. **Herramienta**:
   - Lo que recomienda Supabase es `supabase db dump`, que filtra los esquemas internos y los roles reservados. Esa CLI corre `pg_dump` dentro de **Docker**.
   - En este contenedor la CLI existe (`npx supabase` 2.121.0) pero **no hay demonio de Docker**.
   - El `pg_dump` local es la versión **16**, y `pg_dump` se niega a volcar un servidor más nuevo (17.6).
   - En resumen: hace falta Docker funcionando o un `pg_dump`/`psql` de la versión **17** o superior.
3. **Destino aislado** donde restaurar. **Nunca** se restaura sobre producción. Con la decisión del 20 oct, tampoco en un destino externo: los datos reales solo van a una base que controle el dueño (por ejemplo, `supabase start` en su máquina, que también necesita Docker) y solo cuando él lo habilite. Un segundo proyecto de Supabase sería un destino externo con datos personales; queda descartado salvo decisión expresa. La opción «Restore to a new project» es solo para planes pagos.
4. **El cron viaja con la copia.**
   - Si la restauración trae `cron.job` y los dos secretos de Vault, la copia llama al backend de producción cada minuto, y el resumen de las 6 a. m. se dispara desde dos bases.
   - En la copia, antes de cualquier otra cosa:
     - `cron.unschedule` de las cuatro tareas;
     - borrar los secretos de Vault;
     - comprobar que `cron.job` da 0, que es la última fila de la huella.
   - Supabase recomienda lo mismo para pg_net y pg_cron en una copia.

## Procedimiento propuesto (a correr por quien tenga la credencial)

1. **Ventana**: comprobar en ese momento que no hay partidos en curso ni por empezar en las próximas 2 horas (la 109 lo exige en su encabezado).
2. **Volcado**, con la CLI de Supabase y Docker funcionando. Son tres archivos, como en la guía oficial (*Restore a Platform Project to Self-Hosted*):
   ```sh
   supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
   supabase db dump --db-url "$DB_URL" -f schema.sql
   supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only
   ```
   - `$DB_URL` se carga en el entorno de quien lo corre; nunca se escribe en un archivo del repo.
   - Los tres archivos contienen datos personales y hashes de contraseñas: se guardan cifrados, fuera del repo.
   - Además se descargan los 21 objetos del bucket `avatars`, que no van en el dump. El dueño pidió no tocar avatares por SQL; esto es una descarga, no una escritura.
3. **Huella de origen**: correr `huella_por_tabla.sql` en producción **inmediatamente después** del volcado y guardar el resultado. Algunas tablas cambian solas (`live_sync_state`, `match_details_cache`, `notification_deliveries`); hay que anotar cuáles se movieron entre la huella y el volcado.
4. **Restaurar** en el destino aislado:
   ```sh
   psql --single-transaction -v ON_ERROR_STOP=1 \
     -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql \
     -d "$DESTINO_URL"
   ```
   Si el destino no es PostgreSQL 17, puede fallar `SET transaction_timeout`. La guía oficial indica cómo resolverlo; conviene que el destino también sea 17.
5. **Desactivar el cron y Vault en la copia** (punto 4 de los bloqueos). Eso se hace antes de cualquier otra cosa.
6. **Verificar**:
   - la huella de la copia tiene que coincidir con la de origen, tabla por tabla (filas y md5);
   - `auth.users` y `auth.identities`, mismo conteo;
   - `verificar_estado.sql` tiene que dar lo mismo que en producción (§32 vacía).

   Recién entonces el respaldo cuenta como **restaurable y verificado**. Se anota la fecha, el SHA-256 de los tres archivos y el resultado.
7. **Ensayo sobre la COPIA** (no en producción):
   1. `humo_rutas_del_cliente.sql` como línea base.
   2. 109 → humo → 110 → humo. Cada migración tiene que correr dos veces seguidas sin error.
   3. `verificar_estado.sql`: §29, §30, §31 y §32 tienen que salir vacías, y la §1 no puede listar `_aviso_de_pago_vigente`.
   4. La RPC de cruces (`docs/sql/actualizar_equipos_cruce.propuesta.sql`), con su concurrencia probada en dos conexiones y la ruta `/api/admin/update-match-teams` apuntando a la copia.

   En la copia la humo sí puede borrar dentro de sus subbloques revertidos. Ahí no hay datos reales en riesgo, y es justo lo que la confirmación de Supabase para lo «destructivo» no deja hacer desde esta sesión contra producción.
8. **Producción**: solo después del ensayo verde, con la misma ventana y un volcado nuevo del día. El orden es 109 → humo → 110 → humo, y después la RPC de cruces registrada como migración. Lo aplica el dueño o quien él designe, con `SELECT` antes y después.

## Qué cambió en el repo en esta ronda

- `scripts/respaldo/consultas.sql`:
  - La consulta 2 es dinámica: todas las tablas y columnas de `public`, menos las excluidas a propósito.
  - Antes faltaban `matches.destapado_at` y `jornada_oficial`, `tournaments.unafut_jornadas_at`, `unafut_aviso_firma` y `logo_url`, y la tabla `live_sync_state`.
  - Probada contra un PostgreSQL 16 local:
    - los caracteres `< & >`, la ñ y los emoji salen intactos;
    - el correo queda fuera;
    - una tabla vacía sale como `[]`;
    - 2000 filas sin problema.
  - El mecanismo se probó en producción con una variante que solo devuelve conteos y nombres de columna.
- `scripts/respaldo/generar.py`:
  - Si una tabla de `public` no viene ni está excluida, **no escribe** el MD y sale con código 2.
  - El MD dice explícitamente que no es restaurable.
- `scripts/respaldo/huella_por_tabla.sql` (nuevo):
  - Filas y md5 por tabla, sin datos de personas.
  - Probado en local: dos bases restauradas con `pg_dump` dan la misma huella, y cambiar un solo nombre cambia el md5 de `users`.
  - Corre en producción.
- `database/verificar_estado.sql`: `_aviso_de_pago_vigente` entra al inventario (§1 y §2), y la §32 nueva lista las funciones internas que `authenticated` o `anon` pueden ejecutar. Hoy sale vacía en producción.
- `backend/tests/test_respaldo_semanal.py` (5 pruebas). Mutaciones comprobadas:
  - generador sin el control de tablas: caen 2;
  - `consultas.sql` vieja: cae 1.
