/* Lógica pura del recordatorio de predicciones pendientes.

   Vive aparte de index.ts a propósito: es la parte que se puede equivocar en
   silencio — mandarle el aviso a quien ya predijo es molesto, pero NO mandárselo
   a quien no predijo le cuesta puntos a alguien. Separada, se prueba sin
   Supabase ni push de por medio (ver frontend/src/lib/recordatorios.test.js,
   que corre en el CI).

   Sin dependencias y en JS plano para que lo importen igual Deno y vitest. */

/* Quién queda sin predecir, por persona.

   La unidad real no es el usuario ni el partido: es el par (quiniela, partido).
   Alguien puede estar en dos quinielas del mismo torneo, haber predicho en una
   y no en la otra — y ahí todavía le falta. Por eso se cuentan pares y después
   se agrupan por persona.

   Devuelve Map(user_id -> [partido, ...]) ordenados por hora de saque. */
export function faltantesPorUsuario({ partidos, ligas, miembros, predicciones }) {
  const torneoDeLiga = new Map(ligas.map((l) => [l.id, l.tournament_id]))

  // Quien tiene fila acá, ya predijo ese partido en esa quiniela.
  const yaPredijo = new Set(
    predicciones.map((p) => `${p.league_id}|${p.match_id}|${p.user_id}`),
  )

  // tournament_id -> [{league_id, user_id}, ...]
  const membresiasPorTorneo = new Map()
  for (const m of miembros) {
    const tid = torneoDeLiga.get(m.league_id)
    if (tid == null) continue
    if (!membresiasPorTorneo.has(tid)) membresiasPorTorneo.set(tid, [])
    membresiasPorTorneo.get(tid).push(m)
  }

  const faltantes = new Map()
  for (const partido of partidos) {
    for (const m of membresiasPorTorneo.get(partido.tournament_id) || []) {
      if (yaPredijo.has(`${m.league_id}|${partido.id}|${m.user_id}`)) continue
      if (!faltantes.has(m.user_id)) faltantes.set(m.user_id, [])
      const suyos = faltantes.get(m.user_id)
      // Dos quinielas del mismo torneo comparten el partido: se lista una vez.
      if (!suyos.some((p) => p.id === partido.id)) suyos.push(partido)
    }
  }

  for (const lista of faltantes.values()) {
    lista.sort((a, b) => String(a.kickoff_at).localeCompare(String(b.kickoff_at)))
  }
  return faltantes
}

/* El texto del aviso. Con un solo partido se nombra; con varios se dice cuántos
   y cuál es el primero, que es el que marca la urgencia.

   Va UN push por persona, no uno por partido: en una jornada con cinco partidos
   a la misma hora, cinco notificaciones seguidas son la manera más rápida de
   que alguien apague las notificaciones para siempre. */
export function armarPayload(pendientes) {
  const primero = pendientes[0]
  if (pendientes.length === 1) {
    return {
      title: '⚽ Te falta esta predicción',
      body: `${primero.home_team} vs ${primero.away_team} arranca en ~45 min y ahí se cierra.`,
      url: `/match/${primero.id}`,
    }
  }
  return {
    title: `⏰ Te faltan ${pendientes.length} predicciones`,
    body: `${primero.home_team} vs ${primero.away_team} y ${pendientes.length - 1} más arrancan en ~45 min.`,
    url: '/',
  }
}
