// src/lib/bracketResolver.js
//
// Resuelve los equipos de la fase eliminatoria a partir de los códigos de cada
// llave (ej. "1A" = ganador del grupo A, "2B" = segundo del grupo B,
// "3C/E/F/H/I" = uno de los 8 mejores terceros de esos grupos, "W73" = ganador
// del partido 73, "L101" = perdedor del 101).
//
// Los 8 mejores terceros se asignan a sus slots con un EMPAREJAMIENTO 1-a-1
// (cada slot recibe un tercero de uno de sus grupos candidatos, sin duplicar y
// sin meter equipos eliminados). Esto sigue la estructura real del Mundial 2026.

export function resolveKnockoutTeams(allMatches) {
  const groupsMatches = allMatches.filter(m => m.phase === 'groups');
  const knockoutMatches = allMatches.filter(m => m.phase !== 'groups');

  // 1. Tabla de cada grupo
  const groupStandings = {};
  groupsMatches.forEach(match => {
    const group = match.group_name;
    if (!group) return;
    if (!groupStandings[group]) groupStandings[group] = {};

    const initTeam = (teamName, teamCode) => {
      if (!groupStandings[group][teamName]) {
        groupStandings[group][teamName] = { name: teamName, code: teamCode, pts: 0, gd: 0, gf: 0, pld: 0 };
      }
    };
    initTeam(match.home_team, match.home_team_code);
    initTeam(match.away_team, match.away_team_code);

    if (match.status === 'finished' && match.home_goals_actual !== null && match.away_goals_actual !== null) {
      const home = groupStandings[group][match.home_team];
      const away = groupStandings[group][match.away_team];
      home.pld++; away.pld++;
      home.gf += match.home_goals_actual;
      away.gf += match.away_goals_actual;
      home.gd += (match.home_goals_actual - match.away_goals_actual);
      away.gd += (match.away_goals_actual - match.home_goals_actual);
      if (match.home_goals_actual > match.away_goals_actual) home.pts += 3;
      else if (match.home_goals_actual < match.away_goals_actual) away.pts += 3;
      else { home.pts += 1; away.pts += 1; }
    }
  });

  // Ordenar cada grupo (PTS, DG, GF, nombre)
  const sortedGroups = {};
  const allThirdPlaces = [];
  Object.keys(groupStandings).forEach(group => {
    const teams = Object.values(groupStandings[group]);
    teams.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.name.localeCompare(b.name);
    });
    sortedGroups[group] = teams;
    if (teams.length >= 3 && teams[2].pld > 0) {
      allThirdPlaces.push({ ...teams[2], group });
    }
  });

  // 2. Mejores 8 terceros — SOLO cuando la fase de grupos está completa (todos
  //    los grupos con sus partidos jugados), para no asignar terceros parciales.
  const numGroups = Object.keys(sortedGroups).length;
  const groupStageComplete =
    numGroups >= 12 &&
    Object.values(sortedGroups).every(teams => teams.length >= 4 && teams.every(t => t.pld >= 3));

  allThirdPlaces.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });
  const bestThirds = allThirdPlaces.slice(0, 8);

  // 3. Slots de tercero presentes en las llaves (ej. "3C/E/F/H/I") y asignación
  //    1-a-1 de los mejores terceros a esos slots (emparejamiento bipartito).
  const slotCodes = new Set();
  knockoutMatches.forEach(m => {
    [m.home_team, m.away_team].forEach(c => {
      if (typeof c === 'string' && /^3[A-L]/.test(c) && c.includes('/')) slotCodes.add(c);
    });
  });
  const slots = [...slotCodes].map(code => ({ code, groups: new Set(code.match(/[A-L]/g) || []) }));

  let thirdBySlotCode = {};
  if (groupStageComplete && bestThirds.length === 8) {
    thirdBySlotCode = matchThirdsToSlots(bestThirds, slots);
  }

  // 4. Resolver cada llave
  const resolvedKnockouts = knockoutMatches.map(m => ({ ...m }));

  // Resultados de llaves ya jugadas (W##/L##)
  const matchResults = {};
  resolvedKnockouts.forEach(m => {
    if (m.status === 'finished' && m.home_goals_actual !== null) {
      const homeWins = m.home_goals_actual > m.away_goals_actual;
      matchResults[`W${m.id}`] = homeWins ? { name: m.home_team, code: m.home_team_code } : { name: m.away_team, code: m.away_team_code };
      matchResults[`L${m.id}`] = homeWins ? { name: m.away_team, code: m.away_team_code } : { name: m.home_team, code: m.home_team_code };
    }
  });

  const getTeamFromCode = (code) => {
    if (!code) return null;

    // "1A" / "2B": ganador o segundo de un grupo
    const groupMatch = code.match(/^([12])([A-L])$/);
    if (groupMatch) {
      const pos = parseInt(groupMatch[1]) - 1;
      const group = groupMatch[2];
      const team = sortedGroups[group]?.[pos];
      if (team && team.pld > 0) return { name: team.name, code: team.code, isPartial: team.pld < 3 };
      return null;
    }

    // "3C/E/F/H/I": mejor tercero asignado a este slot (solo con grupos completos)
    if (/^3[A-L]/.test(code) && code.includes('/')) {
      const t = thirdBySlotCode[code];
      if (t) return { name: t.name, code: t.code, isPartial: false };
      return null;
    }

    // "W73" / "L101": ganador / perdedor de otra llave
    if (code.startsWith('W') || code.startsWith('L')) {
      if (matchResults[code]) return { name: matchResults[code].name, code: matchResults[code].code };
      return null;
    }

    return null;
  };

  resolvedKnockouts.forEach(m => {
    const home = getTeamFromCode(m.home_team);
    if (home) {
      m.home_team_resolved = home.name;
      m.home_team_code_resolved = home.code;
      m.home_is_partial = home.isPartial || false;
    }
    const away = getTeamFromCode(m.away_team);
    if (away) {
      m.away_team_resolved = away.name;
      m.away_team_code_resolved = away.code;
      m.away_is_partial = away.isPartial || false;
    }
  });

  return resolvedKnockouts;
}

/**
 * Empareja 1-a-1 los mejores terceros con los slots de tercero. Cada slot solo
 * acepta un tercero de alguno de sus grupos candidatos, y cada tercero se usa
 * una sola vez (emparejamiento bipartito, algoritmo de Kuhn). Determinista.
 * @returns {Object} mapa código-de-slot -> tercero
 */
function matchThirdsToSlots(thirds, slots) {
  const slotMatch = new Array(slots.length).fill(-1); // slot -> índice de tercero

  const tryAssign = (thirdIdx, visited) => {
    for (let s = 0; s < slots.length; s++) {
      if (!visited[s] && slots[s].groups.has(thirds[thirdIdx].group)) {
        visited[s] = true;
        if (slotMatch[s] === -1 || tryAssign(slotMatch[s], visited)) {
          slotMatch[s] = thirdIdx;
          return true;
        }
      }
    }
    return false;
  };

  for (let t = 0; t < thirds.length; t++) {
    tryAssign(t, new Array(slots.length).fill(false));
  }

  const map = {};
  slots.forEach((slot, s) => {
    if (slotMatch[s] !== -1) map[slot.code] = thirds[slotMatch[s]];
  });
  return map;
}
