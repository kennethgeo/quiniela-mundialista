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

## Entorno: qué herramientas hay y dónde

- **Este contenedor** (sesión de Claude): `psql`/`pg_dump` **16**. `pg_dump` se niega a volcar un servidor más nuevo (17.6), así que desde acá no se puede hacer el volcado. La CLI de Supabase existe (`npx supabase` 2.121.0), pero `supabase db dump` corre `pg_dump` dentro de Docker y aquí no hay demonio de Docker. En este contenedor solo se ensaya con datos ficticios.
- **La máquina Windows del dueño**: Codex comprobó que ya tiene `C:/Program Files/PostgreSQL/17/bin/pg_dump.exe` y `psql.exe`. Con esas herramientas nativas **no hace falta Docker**. El procedimiento de abajo usa `pg_dump`/`psql` 17 directamente, no `supabase db dump`, porque la CLI no deja pasar `--snapshot` y la captura consistente lo necesita.
- **Credencial**: el volcado necesita la contraseña de la base. Hoy no hay `SUPABASE_DB_URL` configurada, no se pide por chat y no va al repositorio.

## Reglas que no se negocian

1. **La humo NO se corre en producción.** `database/humo_rutas_del_cliente.sql` escribe y borra dentro de subbloques revertidos (pagos, cuentas, quinielas), y la confirmación de Supabase para lo «destructivo» existe justo por eso. Solo se corre en una copia aislada o con datos ficticios. En producción, solo controles de lectura: `verificar_estado.sql`, `huella_por_tabla.sql` y `SELECT` puntuales.
2. **El destino nunca puede ejecutar trabajos ni salir a la red.** Esto vale **ANTES** de restaurar, no después: si la restauración trae `cron.job` y Vault a una base con pg_cron activo, las tareas pueden correr en el instante del `COMMIT`, antes de que nadie las desactive. Y el `sync-en-vivo` de producción corre cada minuto y llama al backend de producción con el secreto de Vault. Por eso:
   - el destino es un PostgreSQL 17 **sin pg_cron ni pg_net instalados** (no están en `shared_preload_libraries` ni como extensión disponible), y con las **salidas de red bloqueadas** a nivel del sistema o firewall;
   - el volcado **excluye** `cron`, `net` y `vault` (`--exclude-schema`), así que la copia ni siquiera recibe las tareas ni los secretos;
   - después de restaurar se **valida** lo anterior: `select extname from pg_extension where extname in ('pg_cron','pg_net','supabase_vault')` sale vacío, y en la huella `cron.job` dice `no-existe`.
3. **Una restauración con diferencias sin resolver no está verificada.** No se explica una diferencia para darla por buena: se repite la captura.
4. **Destino aislado y del dueño.** Nunca sobre producción. Por la decisión del 20 oct, tampoco en un destino externo: los datos reales van solo a una base que controle el dueño (su PostgreSQL 17 local), y solo cuando él lo habilite. Un segundo proyecto de Supabase sería un destino externo con datos personales, así que queda descartado salvo decisión expresa.

## Captura consistente

Tres volcados separados (roles, esquema, datos), más una huella tomada después con la base viva, no prueban que la copia sea igual a ningún momento real de producción: el cron escribe cada minuto (`live_sync_state`, `matches`, `notification_deliveries`…). Hay dos formas válidas.

**A. Instantánea compartida (preferida: no escribe nada en producción)**

1. Sesión 1, por la **conexión directa** (con el *session pooler* habría que comprobar antes que la sesión se mantiene en el mismo servidor). Esta sesión queda abierta durante todo el proceso:
   ```sql
   BEGIN ISOLATION LEVEL REPEATABLE READ;
   SELECT pg_export_snapshot();   -- p. ej. 00000003-0000001B-1
   ```
2. Esquema y datos en **un solo** `pg_dump` con esa instantánea (formato `custom`, que guarda las dos cosas juntas):
   ```sh
   pg_dump "$DB_URL" --snapshot=<id> -Fc \
     --schema=public --schema=auth --schema=storage \
     --exclude-schema=cron --exclude-schema=net --exclude-schema=vault \
     -f quiniela-AAAA-MM-DD.dump
   ```
   Los roles se sacan aparte con `pg_dumpall --roles-only --no-role-passwords`. No van en la instantánea, pero no cambian con el uso de la app.
3. Huella de origen **dentro de la misma instantánea**, en una segunda sesión:
   ```sql
   BEGIN ISOLATION LEVEL REPEATABLE READ;
   SET TRANSACTION SNAPSHOT '<id>';
   \i scripts/respaldo/huella_por_tabla.sql
   COMMIT;
   ```
4. Recién entonces se cierra la sesión 1 (`COMMIT`).

Ensayado en un PostgreSQL 16 local con datos ficticios:
- se exportó la instantánea;
- se escribió en dos tablas **después** de exportarla;
- se volcó con `--snapshot`;
- se restauró en otra base.

La huella de la copia coincide con la de la instantánea en todas las tablas. La única diferencia es `cron.job` (`no-existe`, excluido a propósito). Una huella tomada con la base viva después del volcado **no** coincidía (`historial_pagos` 2001 contra 2000, y `users`). Ese es justo el falso negativo, o falso positivo, que evita la instantánea compartida.

**B. Congelamiento operativo explícito**

Pausar las cuatro tareas de pg_cron y pedir que nadie use la app durante el volcado. Eso **es una escritura en producción** (`cron.alter_job`), así que queda excluida mientras siga la decisión del dueño de no hacer cambios de base. Solo sirve si él lo decide, y hay que volver a activar las tareas al terminar.

## Procedimiento (para cuando el dueño lo habilite; no es de esta ronda)

1. **Ventana**: comprobar en ese momento que no hay partidos en curso ni por empezar en las próximas 2 horas.
2. **Destino preparado ANTES de restaurar** (regla 2): PostgreSQL 17 sin pg_cron ni pg_net, salidas de red bloqueadas, y los roles de Supabase creados (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`, `supabase_storage_admin`…) para que las políticas y los `GRANT` se restauren tal cual.
3. **Captura consistente** (A).
   - Los archivos contienen datos personales y hashes de contraseñas: se guardan cifrados, fuera del repo, y se anota su SHA-256.
   - Los 21 objetos del bucket `avatars` no van en el volcado. Se descargan aparte; es una lectura, no una escritura.
4. **Restaurar** en el destino (primero los roles, después `pg_restore --single-transaction --exit-on-error`). Cualquier error se investiga; no se sigue «porque el resto entró».
5. **Validar el destino**: sin pg_cron, pg_net ni Vault; `cron.job` `no-existe`.
6. **Verificar**: la huella de la copia tiene que coincidir con la huella de origen, tomada en la misma instantánea, en todas las filas salvo `cron.job`, incluidos `auth.users`, `auth.identities` y `storage.objects`. Con cualquier diferencia sin explicar, **no está verificada** (regla 3). Si coincide, se anotan la fecha, el id de la instantánea, el SHA-256 de los archivos y el resultado.
7. **Ensayo sobre la COPIA**:
   1. `humo_rutas_del_cliente.sql` como línea base (en la copia sí; ver regla 1).
   2. 109 → humo → 110 → humo, y cada migración corre dos veces seguidas sin error.
   3. `verificar_estado.sql`: §29, §30, §31 y §32 vacías, y la §1 no lista `_aviso_de_pago_vigente`.
   4. La RPC de cruces (`docs/sql/actualizar_equipos_cruce.propuesta.sql`), con su concurrencia probada en dos conexiones.
8. **Producción**, solo después del ensayo verde y con una captura nueva del día. Lo aplica el dueño o quien él designe: 109 → 110 → RPC de cruces registrada como migración. Antes y después solo se corren **controles de lectura** (`verificar_estado.sql`, `huella_por_tabla.sql`, `SELECT` de las filas tocadas). **No la humo** (regla 1).

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
  - Filas y md5 por tabla de `public`, `auth.users`, `auth.identities`, `storage.buckets`, `storage.objects` y `cron.job`, sin datos de personas. Una tabla que no existe sale como `no-existe`.
  - Probado en local: con una instantánea compartida, la copia coincide con la captura aunque haya escrituras durante el volcado; con la base viva, no; y cambiar un solo nombre cambia el md5 de `users`.
  - La versión anterior (solo `public` y conteos) corrió en producción con un `SELECT`.
- `database/verificar_estado.sql`: `_aviso_de_pago_vigente` entra al inventario (§1 y §2), y la §32 nueva lista las funciones internas que `authenticated` o `anon` pueden ejecutar. Hoy sale vacía en producción.
- `backend/tests/test_respaldo_semanal.py` (5 pruebas). Mutaciones comprobadas:
  - generador sin el control de tablas: caen 2;
  - `consultas.sql` vieja: cae 1.
