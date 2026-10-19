# Cómo probar la implementación local

Abrí **http://localhost:5173** e iniciá sesión. La versión publicada en Vercel todavía no incluye estos cambios locales.

Se utiliza el Supabase actual. Abrir pantallas y cancelar formularios permite revisar gran parte del trabajo sin guardar cambios. Los botones Guardar, Unirme, votar y las operaciones administrativas conservan sus efectos reales. El refresco automático de resultados está interceptado únicamente en el servidor de desarrollo.

## Recorrido recomendado

| Dónde | Qué probar | Qué debería ocurrir |
| --- | --- | --- |
| Perfil → Tu cuenta | Editar nombre, escribir un borrador y cancelar | Se conserva el nombre guardado. Si elegís guardar un cambio propio, debe actualizarse el encabezado sin alterar puntos ni permisos. |
| Perfil → Tu cuenta | Cambiar contraseña por correo | Se solicita el enlace al correo de la cuenta actual. La contraseña se define en el flujo de recuperación existente; no se introduce en el formulario del perfil. |
| Invitación | Abrir un enlace con código inválido | Se muestra el fallo y se puede reintentar. El Hub conserva el código fallido visible; un enlace nuevo utiliza su propio código. Un enlace válido sí puede incorporar la cuenta a una quiniela. |
| Quiniela → Reglas | Consultar puntaje, reglas y votación existente | Las reglas se ven, los editores ya no están en esta pestaña. Se mantienen los controles para votar. |
| Quiniela → Admin | Abrir un editor, escribir un borrador y cambiar a Reglas; volver a Admin | El borrador sigue presente. Usá Cancelar para terminar la prueba sin guardarlo. Los miembros sin permisos no ven Admin. |
| Quiniela → Partidos | Elegir una jornada, abrir el detalle y pulsar Volver | Regresás al mismo grupo, pestaña y jornada. Un enlace directo con grupo vuelve a ese grupo; un partido inexistente también ofrece una salida válida. |
| Llenar jornada | Probar un empate en eliminatoria con tanda y un 0–0 nuevo sin tocar | El empate requiere elegir quién pasa por penales. Los 0–0 nuevos sin editar exigen confirmación. Una ida empatada no pide tanda. Podés cerrar el formulario sin guardar. |
| Tarjeta de un partido terminado | Comparar los goles predichos y reales | EXACTO depende del marcador, no de tener tres o más puntos. Cambiar las reglas o usar ×2 no altera esa clasificación. |
| Resumen de quiniela | Revisar la efectividad con partidos futuros pendientes | El porcentaje usa los pronósticos de partidos terminados; los futuros no lo reducen. |
| Perfil | Revisar el mismo partido presente en varias quinielas | El contador global lo cuenta una vez. Si las elecciones difieren, se clasifica por el mejor resultado entre ellas; los puntos guardados no se recalculan. El historial de predicciones conserva sus filas por quiniela. |
| Histórico | Cambiar de jornada | La matriz corresponde a los partidos ya destapados de esa jornada. No incorpora los de otra jornada ni revela partidos todavía ocultos. |
| Histórico → Jornadas ganadas | Compartir ganador de jornada | Solo aparece para una jornada cerrada con ganador y puntos positivos. Antes de generar el PNG consulta de nuevo el ganador oficial. Sin soporte de compartir, descarga la imagen. |
| Tema claro/oscuro y zoom | Alternar tema y ampliar la página | El marcador sin foto y el correo sin verificar tienen contraste; la página permite zoom. |

## Lecturas completas del perfil e Histórico

El perfil ahora recorre páginas con conteo exacto para partidos, pronósticos y elecciones globales. Solo presenta los totales después de completar las lecturas. Si una página falla, muestra error y Reintentar; no convierte lo recibido en un total ni lo anuncia como «sin predicciones».

Para no montar cientos de tarjetas de golpe, el perfil muestra 50 inicialmente y ofrece **Mostrar más predicciones** si hay más. Esto limita las tarjetas visibles, no el cálculo de estadísticas. Actividad indica expresamente que muestra hasta 50 movimientos recientes.

El caso de más de mil filas se prueba con datos ficticios: 1.201 partidos y predicciones, entregados en páginas de 200. No hace falta crear predicciones reales para forzarlo. También se prueba un fallo en una página intermedia y su recuperación.

## Funciones que todavía no están activadas

- El cambio de equipos de un cruce requiere la RPC nueva; se mantiene cerrado si no está instalada. Pasó el ensayo PostgreSQL sintético, pero falta comprobar el esquema vigente completo y preparar su activación.
- El simulador tiene contrato y criterios de validación; no hay una pantalla de simulación operativa todavía.
- No se añadió chat por grupo, transferencia de titularidad ni una regla nueva de devolución de aportes.

Estas funciones pendientes no deben buscarse como si ya estuvieran disponibles. El estado completo está en `PLAN_MEJORAS_AUDITORIA_2026-10-16.md` y el diseño de evolución en `EVOLUCION_PARTICIPACION_2026-10-16.md`.
