# Ensayo local de la propuesta de cruces

Se ejecutó el 16 oct 2026 con PostgreSQL 17 instalado en Windows. Usa exclusivamente un clúster desechable en `frontend/node_modules/.cache/postgres-auditoria-20261016`, escucha en `127.0.0.1:55483` y contiene la base `quiniela_auditoria_rpc`. No toma credenciales ni URLs de Supabase.

El arnés `backend/tests/test_rpc_cruces_postgres_local.py` está deshabilitado por defecto. Con `QUINIELA_PG_ENSAYO=1`, primero comprueba con `SHOW data_directory` que la instancia sea exactamente el directorio sintético del proyecto. Solo entonces crea/reinicia las tablas de ensayo. Una instancia distinta es un error, no un destino alternativo.

Esquema probado: tablas mínimas con los tipos y restricciones relevantes (`id` de partido entero, códigos NOT NULL, relación de predicciones), fila testigo de otro torneo y puntos guardados. Carga el texto de la propuesta dos veces y reutiliza las definiciones de `es_backend` (61) y `marcar_destape` (106) del repositorio. **No carga todas las migraciones, políticas y triggers del sistema real**; tampoco introduce un PostgREST local ni certifica su caché de esquema.

Resultado: 23 casos aprobados, incluidos:

- Corrección de solo cuatro campos, conservando resultados, puntos y otro torneo.
- Rechazo por estado, cierre temporal, candado, destape, predicciones existentes, versión anterior, torneo distinto y códigos nulos/vacíos.
- Permisos de anon/authenticated y guarda interna de backend.
- Dos conexiones: INSERT sin confirmar hace rechazar la RPC con `55P03`; una RPC dentro de su transacción bloquea el INSERT; una fila bloqueada por resultados hace rechazar inmediatamente la RPC, sin deadlock.
- Rollback de las sesiones concurrentes, sin filas o cambios residuales.

Las pruebas sincronizan mediante un marcador de la conexión después de tomar el candado; no presuponen que un `sleep` alcanzó para bloquear. Todas las conexiones tienen plazos limitados.

Para repetir en este mismo clúster ya creado, desde PowerShell en la raíz:

```powershell
$env:PYTHONUTF8 = '1'
$env:QUINIELA_PG_ENSAYO = '1'
& .\backend\venv\Scripts\python.exe -m pytest backend/tests/test_rpc_cruces_postgres_local.py -q
```

El servidor debe haberse iniciado expresamente con ese directorio y puerto. Quedó detenido al finalizar esta ejecución. El ensayo falla si no está disponible; no busca una base alternativa. No dejar la variable de ensayo habilitada en CI ni establecerla para una base compartida.

Antes de producción aún se requiere: revisar el esquema vigente completo, ensayar las interacciones con todos sus triggers y privilegios, registrar una nueva migración con el flujo del proyecto y disponer de un respaldo privado cuya restauración se haya comprobado. El éxito de este ensayo no autoriza ni aplica una migración.
