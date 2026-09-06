# Exportación de partidos al calendario

En **Quiniela → Partidos → Llevar partidos a mi calendario** se puede descargar
un archivo `.ics` con la jornada elegida o todos los próximos partidos de la
quiniela. Usa los partidos que GroupPage ya cargó: no hay consultas adicionales
ni escrituras de base, nuevas RPC, migraciones o dependencias.

## Contrato

- Solo exporta partidos `pending`, con inicio futuro y zona horaria explícita.
  Omite terminados, en vivo, cancelados, pospuestos, suspendidos y fechas ausentes
  o no interpretables. Vuelve a filtrar al pulsar Descargar.
- Orden cronológico, un evento por ID entero de partido en la selección.
- Inicio en UTC; duración **estimada** de dos horas, declarada en la descripción.
- Cada evento lleva equipos, sede si existe y enlace a la quiniela/jornada.
  No exporta predicciones, perfiles, correos ni códigos de invitación.
- UID estable por quiniela y partido. No garantiza cómo cada aplicación maneja
  reimportaciones; no se promete deduplicación entre importaciones.
- Es una copia, **no una suscripción**: los cambios de horario y las cancelaciones
  posteriores no se sincronizan. Consultar la app antes del partido.
- No crea alarmas ni contacta cuentas de calendario. Importar el archivo es una
  acción explícita de la persona en su aplicación de calendario.
- RFC 5545: CRLF, escape de texto, plegado a 75 octetos UTF-8 sin cortar caracteres.

## Cómo importarlo

Google Calendar: en una computadora, Configuración → Importar y exportar →
seleccionar `.ics` → elegir calendario de destino → Importar.
Apple Calendar para Mac permite importar `.ics` desde Archivo → Importar.
Conviene usar un calendario de prueba separado para comprobar la importación.
La descarga y apertura en Safari iOS/PWA necesitan verificación en dispositivo real.

Referencias:

- https://support.google.com/calendar/answer/37118?hl=es
- https://support.apple.com/es-es/guide/calendar/icl1023/mac
- https://www.rfc-editor.org/rfc/rfc5545.html

## Validación

`npm test` incluye 12 casos nuevos: UTC y cambio de día, estados/fechas excluidos,
orden y duplicados, IDs inválidos, UID entre quinielas, inyección CRLF, plegado
Unicode, enlaces de jornada, privacidad, selección vacía y reloj al exportar.

`npm run test:ui -- calendario.spec.js` agrega dos pruebas: descargar y leer el
archivo de una jornada, ampliar a toda la quiniela, apertura con teclado,
ausencia de escrituras sobre tablas y selección sin partidos exportables.
Sus datos son simulados; no validan RLS ni conectividad con producción.

Antes de publicar, ejecutar las pruebas de navegador e inspeccionar el panel en
móvil/escritorio y claro/oscuro. Probar la importación en un calendario separado,
sin confundir esa comprobación con una importación hecha por pruebas unitarias.
