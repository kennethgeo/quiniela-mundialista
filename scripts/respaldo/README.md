# Respaldo semanal en MD

En el plan gratis de Supabase no hay respaldos descargables. Esta carpeta arma una **foto legible de los datos** en un solo `.md`, sin tocar la base. Lo pidió el dueño el 28 sep 2026 y corre cada lunes por una rutina programada.

## Qué NO es
**No es un respaldo restaurable.** No trae el esquema, las funciones, las políticas, los triggers, los permisos, Auth, Storage ni el cron: con este archivo solo no se reconstruye la base. Sirve para comparar y para recuperar filas puntuales. El respaldo restaurable (dump + restauración en una base aparte + huella igual) está descrito en `docs/RESPALDO_RESTAURABLE_2026-10-20.md`, y **no se reemplaza con este MD**.

## Qué trae (desde el 20 oct 2026)
La consulta 2 es **dinámica**: recorre todas las tablas de `public` con todas sus columnas, menos las excluidas a propósito (abajo). Antes nombraba columnas a mano y se quedó atrás: faltaban `matches.destapado_at` y `jornada_oficial`, tres columnas de `tournaments`, y `live_sync_state` no aparecía ni contada. Si aparece una tabla que no viene ni está excluida, `generar.py` **no escribe el MD** y sale con código 2.

## Pasos (los sigue la sesión programada)
1. Correr **por separado** las dos consultas de `consultas.sql` con `execute_sql` (proyecto `wifjwtbzstbuiistcxkf`). Son de solo lectura. Por el relleno de espacios, cada respuesta se guarda en un archivo (`…/tool-results/mcp-Supabase-execute_sql-*.txt`); anotar las dos rutas.
2. `python3 scripts/respaldo/generar.py <ruta_consulta_1> <ruta_consulta_2> respaldo-tico-games-AAAA-MM-DD.md`, escribiendo el archivo FUERA del repo (scratchpad).
3. Mandárselo al dueño como archivo adjunto. **Nunca commitearlo ni publicarlo**: tiene nombres, predicciones y pagos.
4. Comprobar y decir en el mensaje los conteos clave: usuarios, membresías, predicciones, pagos confirmados y su suma, quinielas y partidos. Si alguno BAJÓ respecto de la semana anterior sin una razón conocida, avisarlo arriba de todo.

## Qué no va, a propósito
- Correos (`users.email`, `banned_emails`): viven en Supabase Auth.
- Las llaves de `push_subscriptions`: cada quien las recrea al activar avisos.
- `prediction_logs`, `players`, `match_details_cache`, `notification_deliveries`, `powerup_limits`: se regeneran o no afectan puntos. Solo se cuentan.
- De `matches`: `events_json`, `minute` y las URLs de escudos (los vuelve a traer el sync).

## Huella por tabla
`huella_por_tabla.sql` (solo lectura, sin datos de personas) da filas y md5 de cada tabla de `public`, más los conteos de `auth.users`, `auth.identities`, `storage.objects` y `cron.job`. Se corre dentro de la MISMA instantánea que usó el volcado (`SET TRANSACTION SNAPSHOT`) y en la copia restaurada: tienen que coincidir. Una huella tomada aparte, con la base viva, no prueba nada, y una restauración que no dio error no es una restauración verificada. Ver «Captura consistente» en `docs/RESPALDO_RESTAURABLE_2026-10-20.md`.

## Restaurar
Nunca sobre producción a ciegas: cargar el JSON de cada tabla en una base aparte, comparar y copiar solo lo que falte. Para reconstruir la base entera hace falta el dump (ver el documento de arriba).
