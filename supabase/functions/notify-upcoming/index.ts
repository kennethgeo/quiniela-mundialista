// RETIRADA (28 sep 2026). No manda nada: responde 410.
//
// Lo desplegado (v4) NO era este archivo —era una versión anterior, sin el
// filtro de «a quién le falta predecir»— y lo llamaba cron-job.org cada
// 5 minutos con la clave ANÓNIMA. `verify_jwt` acepta esa clave, que es
// pública (va en el frontend), así que con `?test=1` cualquiera podía mandar
// un push a TODAS las suscripciones, sin límite. En modo normal avisaba a
// todos los miembros, sin la deduplicación de la migración 82: quien no había
// predicho recibía dos recordatorios por partido.
//
// El recordatorio de verdad es `POST /api/matches/notify-kickoff` del backend
// (protegido con CRON_SECRET), que dispara pg_cron (migración 79).
// Pendiente del dueño: apagar el trabajo en cron-job.org.
//
// `logica.js` queda porque `frontend/src/lib/recordatorios.test.js` lo prueba;
// ya no lo usa ninguna función desplegada.
Deno.serve(() =>
  new Response(JSON.stringify({ retirada: true, detalle: 'Usar /api/matches/notify-kickoff del backend' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  }),
)
