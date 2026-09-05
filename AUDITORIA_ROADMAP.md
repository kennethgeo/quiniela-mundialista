# Auditoría y hoja de ruta

Fecha: 2026-09-03

## Seguimiento — 2026-09-05

Base verificada: `main c69acc7` (PR #132 mergeado). La lista original de abajo
se conserva como inventario; no significa que todo siga pendiente.

| Área | Estado comprobado y siguiente acción |
| --- | --- |
| Login, sellos técnicos, contador /104 y cupos ×2 | Correcciones anteriores presentes; configurar valores de Champions sigue siendo decisión del grupo. No cambiar reglas por inferencia. |
| Pendientes | Ya desplegado. Este lote agrega filtro por quiniela, expansión real de la lista y retiro por reloj de partidos cerrados. |
| Diseño | Este lote inicia Button común, foco de teclado, controles de 44px, Hub de dos columnas en escritorio y nombres largos legibles. Resta extender el sistema al resto de pantallas. |
| Avatares | 12 activos sin propietario, 2 correctos y 7 candidatos a limpieza. Auditoría reproducible en `database/auditar_avatares.sql`; plan en `RECUPERACION_AVATARES.md`. No se modificó Storage. |
| Guardado de avatar | Este lote confirma la fila actualizada, conserva archivos ante respuestas inciertas, evita sobrescrituras concurrentes y muestra fallos de limpieza antes silenciosos. |
| Recordatorios | Ya existen resumen diario y recordatorio de saque en backend y workflows. Falta verificar ejecuciones y diseñar horarios configurables por usuario; no crear un segundo emisor. |
| Resúmenes y tarjetas | Ya existen jornadas/rachas y tarjetas compartibles del día, jornada y temporada. Ampliar sobre esas piezas, evitando duplicarlas. |
| Calendario externo | Pendiente exportación a Google/Apple Calendar. |
| Invitaciones | Enlace/código existente; pendientes QR y controles de expiración/revocación/uso. |
| Pagos | Pozo/cuota/confirmación existentes; pendientes parciales, historial y CSV. |
| Comunidad | Pendientes chat por quiniela, mute, menciones y moderación. |
| Simulador | Pendiente “si queda así”, separado de puntajes persistidos. |
| Seguridad | CSP, grants anon, límites de avatar y helpers ya endurecidos. Restan revisión individual de RPC y optimizaciones RLS/índices, con pruebas antes de tocar permisos. |
| Validación real | Guardado de predicción y ciclo de avatar siguen pendientes de sesión de prueba. Navegador sin sesión; ingreso seguro interrumpido. |

Validación local de este lote: 166/166 unit tests, build correcto y lint con
0 errores / 53 advertencias. Se agregaron tres pruebas Playwright (17 en total),
pero la ejecución local no pudo arrancar Chromium. No contarlas como aprobadas.
GitHub rechazó crear la rama con 403 `Resource not accessible by integration`.
Hasta publicar y desplegar, los cambios del cliente solo existen en la entrega.

Este documento resume mejoras detectadas tras revisar el estado actual de la app. No requiere cambios de datos para aplicarse: las tareas de base deben ir como migraciones revisables y ejecutarse con autorización explícita.

## 1. Visual y bugs

- Mantener la interfaz alineada con la regla real de comodines ×2: la llave visual debe coincidir con la validación de Postgres por `(phase, matchday)`.
- Evitar valores rígidos en estadísticas globales, como contadores de predicciones con totales fijos.
- Quitar sellos técnicos visibles de producción y dejar ese dato solo para soporte o debug.
- Agregar etiquetas reales, `autocomplete` y roles accesibles en login, registro y recuperación.
- Revisar acciones técnicas visibles para usuarios normales, como la actualización forzada de caché.
- Eliminar, mover a `legacy/` o aislar pantallas antiguas que ya no están enrutadas pero conservan consultas obsoletas.

## 2. Funcionalidades

- Crear un panel "Me falta predecir" por quiniela, ordenado por cierre más cercano.
- Agregar recordatorios configurables antes del cierre de predicciones.
- Generar resumen por jornada: ganador, marcador exacto destacado, uso de ×2 y movimientos de tabla.
- Añadir tarjetas compartibles para ranking, jornada y perfil de jugador.
- Mejorar invitaciones con QR, expiración, revocación y enlaces de un solo uso.
- Crear chat por quiniela con mute, menciones y moderación básica.
- Ampliar pagos con parciales, historial, exportación CSV y recordatorios.
- Agregar simulador "si queda así" para tabla en vivo.

## 3. Seguridad

- Pasar la CSP de `Report-Only` a enforcement cuando los reportes estén limpios.
- Reducir grants amplios a `anon` y apoyarse menos en permisos heredados por `PUBLIC`.
- Limitar el bucket de avatars por MIME y tamaño; conservar compresión en frontend.
- Mantener `database/verificar_estado.sql` sincronizado con cada RPC nueva para detectar deriva real.
- Asegurar que helpers internos como `cupo_powerups` no tengan `EXECUTE` para `authenticated`.
- Evitar `select('*')` en pantallas de usuario normal; preferir columnas explícitas o RPC acotadas.
- Agregar índices para consultas frecuentes: `push_subscriptions(user_id)`, `global_chat(created_at)` y `tournament_predictions(league_id)`.

## 4. Diseño

- Formalizar componentes base: `Button`, `IconButton`, `Chip`, `Card`, `MatchCard`, `Modal`, `EmptyState`, `ErrorState` y filas de tabla.
- Reducir glow, vidrio y gradientes donde no aportan jerarquía; reservarlos para estados importantes.
- Estandarizar radios, sombras, bordes y espaciado.
- En desktop, usar layouts de dos columnas en quinielas: contexto/resumen a un lado y acción principal al otro.
- Dar más peso visual a pendientes, partidos en vivo y cierre próximo.
- Mejorar estados vacíos con mensajes concretos y acciones claras.
