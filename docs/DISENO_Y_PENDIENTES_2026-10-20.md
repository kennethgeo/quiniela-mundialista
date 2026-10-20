# Tico Games: identidad y pendientes de código

## Alcance de esta ronda

El dueño pidió aplicar los pendientes y mejorar el aspecto, que se estaba volviendo genérico. Después indicó continuar **sin cambios de base de datos**. No aplicar migraciones, recálculos reales, limpiezas de suscripciones ni cambios de saldo. Un respaldo MD no sustituye una copia restaurable de PostgreSQL.

## Dirección visual

La referencia es el marcador y la hoja de una quiniela de fútbol: el puntaje tiene protagonismo, los premios tienen puesto y los pagos son un registro de personas. Conservar Archivo para lectura y Unbounded para los números principales; evitar sumar otra familia.

Paleta local a estas secciones: azul estadio `#17324D`, blanco `#FFFFFF`, papel frío `#F6F8FB`, verde legible `#0B756B`, menta `#2ED3B7` y oro `#9A6100`. El modo oscuro conserva las superficies de la app y ajusta texto y estados para contraste.

```
Puntaje                         Editar / Proponer
  [ marcador exacto   3 ] [ resultado correcto 1 ]
  Comodines ×2       cupo fijo / frecuencia
  Elecciones         campeón / goleador / asistidor

Pozo y pagos                    Compartir / Configurar
  Recaudado (protagonista)       Meta y cuota
  progreso + personas al día
  Premios por puesto
  Tu estado
  Pagos del grupo (filas)
```

Revisión antes de construir: no usar un hero con gradiente ni otra cuadrícula de tarjetas iguales. Reservar el bloque de mayor contraste para el pozo, el tamaño de los números para el puntaje, y las líneas de separación para personas y premios. Sin animaciones ornamentales ni nuevos sondeos. Mobile primero, foco visible y controles con nombre accesible.

## Correcciones funcionales

- Cancelar puntaje descarta valores y motivo; reabrir toma la configuración actual. Cambiar de pestaña conserva el borrador.
- Guardar pendiente bloquea edición y cancelación. Un rechazo conserva el borrador y muestra el error junto al formulario.
- Votar/cancelar libera el estado ocupado al terminar. Se puede cambiar voto sin recargar; no inventar conteos optimistas.
- Predicciones de la quiniela: el error se conserva junto al partido que falló, aunque se guarde otro; el reintento conserva el marcador. La lista se reinicia al cambiar de cuenta o quiniela.
- Dólares: conservar centavos en pantalla, bitácora e imagen compartida. La mitad de una cuota y la conversión de porcentajes a montos conservan dos decimales.
- Backend y scripts: carril de Claude, coordinado desde su aplicación, sin solapar frontend.

## Base de datos

`pg_dump` y `psql` 17 están instalados. No hay una conexión directa a PostgreSQL configurada. El usuario eligió continuar sin cambios de base de datos. 109/110, RPC de cruces y desbloqueo del borrado conservan sus requisitos de respaldo restaurado y ensayo. No afirmar que están habilitados por integrar código.

## Verificación

- 409 pruebas unitarias aprobadas; compilación y PWA correctas.
- ESLint: 0 errores, 30 advertencias existentes.
- 18 regresiones de puntaje/votos/errores por partido e historial aprobadas. El historial ahora busca filas por `data-persona`, no por clases de espaciado.
- Capturas con datos ficticios en claro/oscuro y 390/960 px: revisados importes, jerarquía, superficies y contraste. La red externa se bloquea en estas pruebas y las fuentes usan su alternativa del sistema. La revisión de la app real en localhost completa la comprobación.
- Suite completa final: **306 pruebas de interfaz aprobadas**, sin reintentos (3,6 minutos). No se modificaron archivos de implementación durante la corrida final.
- El backend de Claude en `b05b969` pasó una revisión independiente de **548 pruebas**, con 23 ensayos PostgreSQL optativos omitidos. Se exportó el código de ese commit en un directorio ignorado con sus fixtures; credenciales ficticias y sin acceso a datos reales. El ensayo anterior de esos 23 casos no sustituye el ensayo pendiente del esquema productivo.
