# Evolución de la quiniela: decisiones y contratos pendientes

Fecha: 16 de octubre de 2026. Complementa el plan de auditoría. Este documento no crea endpoints, tablas, migraciones ni cambios de producción.

## Entregado en código local

La tarjeta del ganador está en Histórico, junto a Jornadas ganadas. Solo se ofrece para la última jornada cerrada con ganador y puntos positivos. Consulta de nuevo `league_jornadas` al pulsar Compartir; no deriva un ganador de la matriz del Histórico ni de un umbral de puntos. Una jornada reabierta o sin ganador impide exportar. La imagen incluye nombre, jornada, puntos, fecha de consulta y aviso de posibles correcciones. Usa el mecanismo existente de compartir/descargar y no envía mensajes automáticamente.

La página declara idioma español y permite ampliar con zoom. La lectura de llaves del Mundial se limita al torneo 1; no cambia datos.

## Prioridad siguiente: simulador de posiciones

El resultado debe responder «¿qué pasa en esta quiniela si este partido termina así?» sin modificar resultados ni predicciones. No se implementa una segunda fórmula de puntaje en JavaScript. `puntosPorQuiniela` en el detalle es un mapa de totales guardados y no sirve como motor de simulación.

### Contrato propuesto, todavía no implementado

`POST /api/simulations/standings`, autenticado, sin escrituras. Entrada:

```json
{
  "league_id": "UUID de una quiniela accesible",
  "scenarios": [
    {
      "match_id": "UUID de un partido del torneo de esa quiniela",
      "home_goals": 2,
      "away_goals": 2,
      "goes_to_penalties": true,
      "penalties_winner": "identidad de uno de los equipos"
    }
  ]
}
```

1. Validar pertenencia y permisos con la identidad solicitante. Una clave de servicio no puede convertir el simulador en una vía de lectura de predicciones ocultas. No recibir predicciones, puntos ni usuarios arbitrarios en la petición.
2. Limitar a 20 partidos distintos del mismo torneo; rechazar IDs duplicados, goles fuera de rango, idas con tanda y ganadores ajenos al cruce. Definir el rango de goles antes de publicar el contrato.
3. La primera versión solo simulará partidos destapados para todos los miembros, según el cierre del servidor. Si se ofrece antes una simulación personal, debe devolver solo el resultado personal, sin totales ni puestos que permitan inferir elecciones ajenas. No completar datos ocultos con cero.
4. Leer una instantánea coherente de reglas, resultados, predicciones visibles y clasificación. Si la integración actual no permite esa coherencia, primero diseñar una lectura transaccional y ensayarla; varias consultas de servicio independientes no la garantizan.
5. Para cada fila afectada, reutilizar `evaluate_prediction` del backend con las reglas de la quiniela y el escenario. El total proyectado es el total actual menos la contribución guardada del partido, más su contribución simulada. Así no se suma dos veces un partido ya terminado.
6. Actualizar también los datos de desempate afectados, no solo los puntos. La escalera oficial vive en `league_table`/`group_standings`, definida a partir de la migración 55. Extraer un contrato compartido y probar equivalencia contra SQL antes de ordenar escenarios en Python; no cambiar la clasificación real para introducirlo.
7. Mantener las predicciones globales (campeón/goleador/asistidor) y ajustes como componentes actuales identificados; no inferir su resolución a partir de un solo marcador.
8. Respuesta: identificador de versión de la instantánea, reglas usadas, escenarios, tabla actual y proyectada, diferencias de puntos/puesto, alcance y etiqueta «Simulación». La versión debe reflejar cambios en reglas, resultados y predicciones utilizadas. El servidor no debe almacenar ni registrar sus contenidos sensibles.
9. Ninguna ejecución llama al recálculo real, a medallas, a push, a escrituras administrativas ni a una función SQL con efectos.

### Pruebas que habilitan su implementación

- Corpus del motor: reglas personalizadas, ×2, empate, penales, elección incorrecta de tanda, ida, datos incompletos y partido anulado.
- Equivalencia del desempate con PostgreSQL usando casos empatados en cada escalón, incluidos antigüedad y empates completos. Si falta un desempate determinista final, decidirlo antes de prometer puestos exactos.
- Escenario igual al resultado real produce diferencia cero; un partido futuro no resta una contribución que no existe; no duplicar escenarios.
- Dos quinielas del mismo torneo con reglas y picks distintos permanecen aisladas.
- No miembro, cambio de usuario, predicciones no destapadas, corrección durante lectura y fallo de red producen errores explícitos, sin tabla inventada ni escrituras.
- Medir latencia y tamaño con 20 partidos y el número real de miembros. Definir límites y estrategia de caché por usuario/quiniela/versión; nunca cachear datos privados entre cuentas.

## Chat por quiniela

Ya existe `GlobalChatDrawer`; un chat de grupo sería otro alcance, no «añadir el primer chat». Antes de crear tablas: comprobar con participantes si resuelve una necesidad frente al enlace de WhatsApp existente. Definir moderación, eliminación, retención, notificaciones y quién conserva acceso al salir o ser expulsado.

Si se aprueba: membresía validada en servidor/RLS para lectura, inserción y suscripción; fecha del servidor; contenido tratado como texto; paginación y límites por usuario; pruebas de dos grupos y de expulsión con conexión abierta. No reutilizar una tabla global suponiendo que un filtro del navegador constituye un permiso.

## Titularidad y aportes

No se crea un RPC de transferencia sin definir aceptación del destinatario, elegibilidad, permisos del creador anterior y recuperación ante una invitación rechazada o vencida. La transferencia final debe ser atómica y registrar a ambos titulares sin copiar ni borrar predicciones.

Los aportes de una persona expulsada requieren una regla explícita sobre devolución y cálculo del pozo. Se conserva el comportamiento vigente y su historial; este trabajo no inventa devoluciones, reasignaciones ni cambios de saldo. Antes de implementar: matriz de permisos y escenarios con pagos confirmados, pendientes y devoluciones, seguida de ensayo en PostgreSQL aislado.

## Rendimiento: medir antes de ampliar cambios

Las pruebas locales con red interceptada comprueban comportamiento y número de llamadas, pero no miden latencia ni carga reales de Supabase. No se presenta esa latencia artificial como mejora de producción.

Próxima medición de solo lectura, sin registrar tokens ni nombres:

| Flujo | Medición | Decisión que habilita |
| --- | --- | --- |
| Hub | peticiones, bytes, consultas duplicadas al abrir y volver | paginación o ajuste de caché |
| Grupo/partidos | tamaño de `matches`, predicciones y canales activos por pestaña | columnas explícitas, suscripciones por vista |
| Perfil | cantidad real de partidos/picks frente al límite de respuesta de PostgREST; tiempo de unión | paginación completa e índices de unión en memoria |
| Histórico | predicciones visibles y bytes por jornada | consulta acotada sin romper destape ni compartir |
| Admin | lecturas al alternar pestañas y estado de borradores | mantener borradores sin mantener sondeos ocultos |

Tomar al menos 20 muestras de cada flujo en móvil con red comparable; separar caché fría y caliente y obtener mediana/p95. Comparar consultas y canales antes/después de una optimización concreta. Revisar índices con planes de consultas de solo lectura en una base aislada representativa; no borrar vistas/rutas/índices por ausencia de referencias en una búsqueda de código.

## Orden de avance

1. Ensayar la RPC administrativa ya propuesta antes de habilitar cambios de equipos.
2. Perfil/Histórico: comprobado el límite de lectura, implementada la paginación y el filtro de jornada. Completar mediciones de latencia representativas y revisar lecturas restantes antes de anunciar mejoras de rendimiento.
3. Ensayar motor y desempate del simulador en una base aislada; recién entonces implementar el endpoint y su interfaz.
4. Validar interés del chat y cerrar las reglas de titularidad/aportes antes de diseñar migraciones.

Este orden reduce el riesgo operativo. La tarjeta y las mejoras de uso no implican aprobación ni activación de las funciones pendientes.
