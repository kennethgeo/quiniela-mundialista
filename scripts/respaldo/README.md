# Respaldo semanal en MD

En el plan gratis de Supabase no hay respaldos descargables. Esta carpeta arma una **foto legible de todos los datos** en un solo `.md`, sin tocar la base. Lo pidió el dueño el 28 sep 2026 y corre cada lunes por una rutina programada.

## Pasos (los sigue la sesión programada)
1. Correr **por separado** las dos consultas de `consultas.sql` con `execute_sql` (proyecto `wifjwtbzstbuiistcxkf`). Son de solo lectura. Por el relleno de espacios, cada respuesta se guarda en un archivo (`…/tool-results/mcp-Supabase-execute_sql-*.txt`); anotar las dos rutas.
2. `python3 scripts/respaldo/generar.py <ruta_consulta_1> <ruta_consulta_2> respaldo-tico-games-AAAA-MM-DD.md`, escribiendo el archivo FUERA del repo (scratchpad).
3. Mandárselo al dueño como archivo adjunto. **Nunca commitearlo ni publicarlo**: tiene nombres, predicciones y pagos.
4. Comprobar y decir en el mensaje los conteos clave: usuarios, membresías, predicciones, pagos confirmados y su suma, quinielas y partidos. Si alguno BAJÓ respecto de la semana anterior sin una razón conocida, avisarlo arriba de todo.

## Qué no va, a propósito
- Correos (`users.email`, `banned_emails`): viven en Supabase Auth.
- Las llaves de `push_subscriptions`: cada quien las recrea al activar avisos.
- `prediction_logs`, `players`, `match_details_cache`, `notification_deliveries`, `powerup_limits`: se regeneran o no afectan puntos. Solo se cuentan.

## Restaurar
Nunca sobre producción a ciegas: cargar el JSON de cada tabla en una base aparte, comparar y copiar solo lo que falte.
