# Auditoría y hoja de ruta

Fecha: 2026-09-03

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
