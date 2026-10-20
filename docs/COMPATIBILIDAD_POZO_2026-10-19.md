# Coordinación con Claude y compatibilidad del pozo

## Punto de partida

El dueño pidió trabajar con Claude desde su app y cerrar la siguiente entrega mediante PR y merge. Se le envió el contexto completo en la sesión **Scroll reach issue**, incluida la entrega del PR #205, integrado en `8d59b1664c4ecb3490e039cd5b03032bef156121`, y los pendientes documentados.

Claude confirmó mediante su acceso a Supabase que estaba inspeccionando el proyecto de la quiniela y que las migraciones aplicadas llegaban a la 108. Después volvió a agotar su uso. Su app mostró reanudación automática para el 19 de octubre a las 18:01 de Costa Rica. Esa hora es el estado observado de la app, no una garantía de disponibilidad. No se compraron créditos ni se cambiaron sus preferencias.

## División de trabajo comunicada

- Codex: rama `codex/compatibilidad-pozo-109-110`; `PozoYPagos`, `MiembrosYAdmins`, detección del historial y regresiones del pozo.
- Claude: Cara a cara, contraste del esquema real y plan de migraciones; después, globales, estados de predicciones y guardas de eliminación según su auditoría revalidada.
- Revisión antes del merge: comprobar el diff y las pruebas de cada PR. No ejecutar dos implementaciones sobre los mismos archivos ni descartar trabajo propio de Claude.

## Correcciones del carril Codex

1. `confirmar_abono` recibe los cinco argumentos de la migración 110. El aviso visto es el monto del aviso vigente, o `null` si no había aviso. Una respuesta de error no dispara `confirmar_pago` como alternativa ni descarta el formulario.
2. La disponibilidad del historial se consulta con `id`, bajo la sesión del usuario y filtro de quiniela. Solo los errores de tabla ausente (`PGRST205`/`42P01`) indican que falta; errores de servicio o permisos se muestran y permiten reintentar.
3. Antes de la 109 no aparece un enlace a un historial inexistente ni se promete que quitar o expulsar dejará un registro. Con solo la 109, la lista no solicita `monto_total`, columna que incorpora la 110. La clave de caché distingue ambas formas.
4. Si falla comprobar el pago de quien se va a expulsar, la acción queda bloqueada y ofrece reintentar. La comprobación no modifica membresías ni pagos.
5. Un aviso pendiente permite abrir la gestión de su pago; el registro manual conserva el aviso visto para el control de concurrencia de la base.
6. El editor conserva un borrador por modo de reparto: ir a porcentajes y volver no redondea ni reemplaza los montos originales. La validación distingue un exceso real del pequeño error binario al sumar porcentajes decimales.

## SQL y datos

Esta rama no aplica SQL ni cambia las migraciones 109/110. No prueba escrituras sobre pagos, predicciones o membresías reales. Las pruebas de interfaz usan Supabase ficticio.

Antes de aplicar 109/110 sigue pendiente revisar el esquema y sus permisos/triggers, respaldar, verificar restauración y desplegar el frontend compatible. La RPC de cruces sigue siendo una propuesta separada: no activarla ni marcarla como validada en producción por estas pruebas.

Los conteos finales de pruebas y el commit revisado se registran en el PR de esta rama. La consulta del historial verifica su disponibilidad para lectura; no sustituye la inspección del trigger de bitácora que debe completar Claude.
