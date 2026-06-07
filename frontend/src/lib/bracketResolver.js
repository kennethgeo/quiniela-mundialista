// src/lib/bracketResolver.js

export function resolveKnockoutTeams(allMatches) {
  const groupsMatches = allMatches.filter(m => m.phase === 'groups');
  const knockoutMatches = allMatches.filter(m => m.phase !== 'groups');

  // 1. Calculate standings for each group
  const groupStandings = {};
  
  groupsMatches.forEach(match => {
    const group = match.group_name;
    if (!group) return;

    if (!groupStandings[group]) {
      groupStandings[group] = {};
    }

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

      if (match.home_goals_actual > match.away_goals_actual) {
        home.pts += 3;
      } else if (match.home_goals_actual < match.away_goals_actual) {
        away.pts += 3;
      } else {
        home.pts += 1;
        away.pts += 1;
      }
    }
  });

  // Sort standings per group
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

    // Solo considerar terceros si el grupo ya jug algo
    if (teams.length >= 3 && teams[2].pld > 0) {
      allThirdPlaces.push({ ...teams[2], group });
    }
  });

  // 2. Determine top 8 third places (si ya hay suficientes datos)
  allThirdPlaces.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });
  
  const bestThirds = allThirdPlaces.slice(0, 8);
  // Diccionario rapido para buscar si un grupo pas como 3ro
  const thirdPlaceByGroup = {};
  bestThirds.forEach(t => thirdPlaceByGroup[t.group] = t);

  // Helper para buscar equipo por cdigo (ej: '1A', '2B')
  const getTeamFromCode = (code) => {
    if (!code) return null;
    
    // Si es "1A", "2B"
    const groupMatch = code.match(/^([12])([A-L])$/);
    if (groupMatch) {
      const pos = parseInt(groupMatch[1]) - 1;
      const group = groupMatch[2];
      const team = sortedGroups[group]?.[pos];
      if (team && team.pld > 0) return { name: team.name, code: team.code, isPartial: team.pld < 3 };
      return null;
    }

    // Si es 3er lugar (ej "3A/B/C/D/F" o similar)
    if (code.startsWith('3')) {
      // Logica simplificada: buscar el mejor tercero de los grupos mencionados en el string que haya clasificado
      const possibleGroups = code.match(/[A-L]/g) || [];
      for (const pg of possibleGroups) {
        if (thirdPlaceByGroup[pg]) {
          const team = thirdPlaceByGroup[pg];
          return { name: team.name, code: team.code, isPartial: team.pld < 3 };
        }
      }
      
      // Fallback si no encaja ninguno en los mencionados (porque no tenemos la tabla completa de 495)
      // Tomamos el primer mejor tercero que an no haya sido asignado.
      // Pero como esto es funcional y React llama esto por cada partido, es complejo mantener estado global as de facil.
      // Mejor retornar null hasta que haya terminado la fase de grupos o solo usar el fallback si el grupo termin.
      if (allThirdPlaces.length > 0) {
        return null; // Dejamos pendiente si no coincide la heurstica bsica por ahora
      }
    }

    return null;
  };

  // 3. Resolve matches iteratively
  const resolvedKnockouts = knockoutMatches.map(m => ({ ...m }));
  
  // Diccionario para resultados de llaves (ej W73)
  const matchResults = {};
  resolvedKnockouts.forEach(m => {
    if (m.status === 'finished' && m.home_goals_actual !== null) {
      const homeWins = m.home_goals_actual > m.away_goals_actual;
      matchResults[`W${m.id}`] = homeWins ? { name: m.home_team, code: m.home_team_code } : { name: m.away_team, code: m.away_team_code };
      matchResults[`L${m.id}`] = homeWins ? { name: m.away_team, code: m.away_team_code } : { name: m.home_team, code: m.home_team_code };
    }
  });

  resolvedKnockouts.forEach(m => {
    // Resolver Home
    if (m.home_team.match(/^[123][A-L].*/)) {
      const t = getTeamFromCode(m.home_team);
      if (t) {
        m.home_team_resolved = t.name;
        m.home_team_code_resolved = t.code;
        m.home_is_partial = t.isPartial;
      }
    } else if (m.home_team.startsWith('W') || m.home_team.startsWith('L')) {
      if (matchResults[m.home_team]) {
        m.home_team_resolved = matchResults[m.home_team].name;
        m.home_team_code_resolved = matchResults[m.home_team].code;
      }
    }

    // Resolver Away
    if (m.away_team.match(/^[123][A-L].*/)) {
      const t = getTeamFromCode(m.away_team);
      if (t) {
        m.away_team_resolved = t.name;
        m.away_team_code_resolved = t.code;
        m.away_is_partial = t.isPartial;
      }
    } else if (m.away_team.startsWith('W') || m.away_team.startsWith('L')) {
      if (matchResults[m.away_team]) {
        m.away_team_resolved = matchResults[m.away_team].name;
        m.away_team_code_resolved = matchResults[m.away_team].code;
      }
    }
  });

  return resolvedKnockouts;
}
