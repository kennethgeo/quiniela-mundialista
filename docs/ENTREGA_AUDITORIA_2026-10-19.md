# Entrega de auditoría — 19 de octubre de 2026

Trabajo preparado en `codex/mejoras-auditoria-seguras`, desde `9e33076`, para integrar en main a solicitud del dueño. Los registros del 16 de octubre describen las comprobaciones de ese día; este documento registra el cierre de la integración y sirve de punto de continuidad para Claude.

## Implementación incluida

- Exactos por marcador, efectividad sobre finalizados, estadísticas globales por partido y diferencias completas en votaciones.
- Lote de jornada con elección de penales, confirmación de ceros nuevos, un solo guardado y conservación del formulario ante rechazo.
- Sincronización aislada por torneo, controles de concurrencia, respeto de candados y notificaciones con deduplicación persistente existente.
- Panel de cruces mediante backend administrativo; eliminación del respaldo posicional legado del Mundial.
- Cuenta, invitaciones recuperables, retorno al grupo/jornada, contraste, zoom, separación Reglas/Admin y borradores conservados.
- Tarjeta del ganador oficial con consulta actualizada antes de exportar.
- Lecturas paginadas del perfil y del Histórico, errores visibles y filtro del Histórico por jornada destapada.

## Pendientes que el merge no activa

1. `docs/sql/actualizar_equipos_cruce.propuesta.sql` es una propuesta, no una migración registrada. Pasó 23 casos en PostgreSQL 17 con esquema sintético y dos conexiones. Falta revisar el esquema vigente completo, sus triggers/privilegios y PostgREST; registrar una migración y preparar respaldo/restauración antes de aplicarla. Sin la RPC, el endpoint rechaza el cambio y no hace UPDATE de respaldo.
2. Las conexiones de Supabase disponibles en la revisión del 16 de octubre no incluían el proyecto de la quiniela. No se usaron otros proyectos para ejecutar SQL. Confirmar acceso al proyecto correcto antes de continuar esa integración.
3. Simulador: contrato y pruebas de aceptación en `EVOLUCION_PARTICIPACION_2026-10-16.md`; aún no hay simulador operativo ni un segundo motor de puntaje en el cliente.
4. Chat por grupo, transferencia de titularidad y política de aportes/devoluciones necesitan las decisiones descritas en ese documento. No hay migraciones para esas funciones.
5. Las mediciones de volumen confirmaron el límite de respuesta de la API. Falta medir latencia representativa; las respuestas ficticias de las pruebas no son una medición de producción.

## Para probar y continuar

- Recorridos de prueba: `GUIA_PRUEBAS_LOCALES_2026-10-16.md`.
- Estado y evidencia histórica: `PLAN_MEJORAS_AUDITORIA_2026-10-16.md`.
- Ensayo SQL: `sql/README_ENSAYO_CRUCES.md` y `backend/tests/test_rpc_cruces_postgres_local.py`.
- Localhost usa Supabase actual: los guardados manuales modifican datos reales. El servidor de desarrollo intercepta únicamente el refresco automático de resultados. Este comportamiento no se incluye como servidor de producción.

## Comprobaciones de integración

Se registrarán aquí los resultados actuales de backend, frontend, interfaz y CI antes de completar el merge. No se aplicarán migraciones ni se harán recálculos de producción para validar esta entrega.
