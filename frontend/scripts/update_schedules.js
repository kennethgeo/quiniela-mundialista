import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const teamNamesMap = {
  "México": "Mexico",
  "Sudáfrica": "South Africa",
  "Corea del Sur": "South Korea",
  "Chequia": "Czechia",
  "Canadá": "Canada",
  "Bosnia y Herz.": "Bosnia-Herzegovina",
  "Qatar": "Qatar",
  "Suiza": "Switzerland",
  "Brasil": "Brazil",
  "Marruecos": "Morocco",
  "Haití": "Haiti",
  "Escocia": "Scotland",
  "Australia": "Australia",
  "Türkiye": "Türkiye",
  "EE.UU.": "USA",
  "Paraguay": "Paraguay",
  "Alemania": "Germany",
  "Curazao": "Curaçao",
  "Costa de Marfil": "Ivory Coast",
  "Ecuador": "Ecuador",
  "Países Bajos": "Netherlands",
  "Japón": "Japan",
  "Suecia": "Sweden",
  "Túnez": "Tunisia",
  "Bélgica": "Belgium",
  "Egipto": "Egypt",
  "Arabia Saudita": "Saudi Arabia",
  "Uruguay": "Uruguay",
  "España": "Spain",
  "Cabo Verde": "Cape Verde",
  "Nueva Zelanda": "New Zealand",
  "Irán": "Iran",
  "Francia": "France",
  "Senegal": "Senegal",
  "Noruega": "Norway",
  "Irak": "Iraq",
  "Argentina": "Argentina",
  "Austria": "Austria",
  "Argelia": "Algeria",
  "Jordania": "Jordan",
  "Portugal": "Portugal",
  "Congo RD": "DR Congo",
  "Inglaterra": "England",
  "Croacia": "Croatia",
  "Colombia": "Colombia",
  "Ghana": "Ghana",
  "Panamá": "Panama",
  "Uzbekistán": "Uzbekistan"
};

const rawMatches = `
2026-06-11T19:00:00Z | México vs Sudáfrica
2026-06-12T02:00:00Z | Corea del Sur vs Chequia
2026-06-18T16:00:00Z | Chequia vs Sudáfrica
2026-06-19T01:00:00Z | México vs Corea del Sur
2026-06-25T01:00:00Z | Chequia vs México
2026-06-25T01:00:00Z | Sudáfrica vs Corea del Sur
2026-06-12T19:00:00Z | Canadá vs Bosnia y Herz.
2026-06-13T03:00:00Z | Qatar vs Suiza
2026-06-18T19:00:00Z | Suiza vs Bosnia y Herz.
2026-06-18T22:00:00Z | Canadá vs Qatar
2026-06-25T19:00:00Z | Suiza vs Canadá
2026-06-25T19:00:00Z | Bosnia y Herz. vs Qatar
2026-06-13T22:00:00Z | Brasil vs Marruecos
2026-06-14T01:00:00Z | Haití vs Escocia
2026-06-19T22:00:00Z | Escocia vs Marruecos
2026-06-20T01:00:00Z | Brasil vs Haití
2026-06-25T22:00:00Z | Marruecos vs Haití
2026-06-25T22:00:00Z | Escocia vs Brasil
2026-06-13T01:00:00Z | Australia vs Türkiye
2026-06-13T01:00:00Z | EE.UU. vs Paraguay
2026-06-19T19:00:00Z | EE.UU. vs Australia
2026-06-20T04:00:00Z | Türkiye vs Paraguay
2026-06-26T01:00:00Z | EE.UU. vs Türkiye
2026-06-26T01:00:00Z | Paraguay vs Australia
2026-06-14T17:00:00Z | Alemania vs Curazao
2026-06-14T23:00:00Z | Costa de Marfil vs Ecuador
2026-06-20T17:00:00Z | Alemania vs Costa de Marfil
2026-06-21T00:00:00Z | Ecuador vs Curazao
2026-06-26T19:00:00Z | Alemania vs Ecuador
2026-06-26T19:00:00Z | Costa de Marfil vs Curazao
2026-06-14T20:00:00Z | Países Bajos vs Japón
2026-06-15T02:00:00Z | Suecia vs Túnez
2026-06-20T20:00:00Z | Países Bajos vs Suecia
2026-06-21T04:00:00Z | Túnez vs Japón
2026-06-26T22:00:00Z | Países Bajos vs Túnez
2026-06-26T22:00:00Z | Suecia vs Japón
2026-06-15T22:00:00Z | Bélgica vs Egipto
2026-06-16T01:00:00Z | Arabia Saudita vs Uruguay
2026-06-21T17:00:00Z | Bélgica vs Irán
2026-06-22T01:00:00Z | Uruguay vs Cabo Verde
2026-06-27T01:00:00Z | Bélgica vs Uruguay
2026-06-27T01:00:00Z | Irán vs Arabia Saudita
2026-06-15T16:00:00Z | España vs Cabo Verde
2026-06-16T02:00:00Z | Arabia Saudita vs Nueva Zelanda
2026-06-21T16:00:00Z | España vs Arabia Saudita
2026-06-21T23:00:00Z | Cabo Verde vs Nueva Zelanda
2026-06-26T22:00:00Z | España vs Nueva Zelanda
2026-06-26T22:00:00Z | Cabo Verde vs Arabia Saudita
2026-06-16T19:00:00Z | Francia vs Senegal
2026-06-16T22:00:00Z | Irak vs Noruega
2026-06-22T17:00:00Z | Argentina vs Austria
2026-06-22T21:00:00Z | Francia vs Irak
2026-06-27T21:00:00Z | Argentina vs Francia
2026-06-27T21:00:00Z | Noruega vs Senegal
2026-06-17T02:00:00Z | Austria vs Jordania
2026-06-17T02:00:00Z | Argentina vs Argelia
2026-06-23T01:00:00Z | Noruega vs Irak
2026-06-23T01:00:00Z | Argelia vs Jordania
2026-06-28T01:00:00Z | Argelia vs Irak
2026-06-28T01:00:00Z | Jordania vs Austria
2026-06-17T17:00:00Z | Portugal vs Congo RD
2026-06-17T20:00:00Z | Inglaterra vs Croacia
2026-06-23T17:00:00Z | Portugal vs Colombia
2026-06-23T21:00:00Z | Inglaterra vs Ghana
2026-06-28T19:00:00Z | Portugal vs Inglaterra
2026-06-28T19:00:00Z | Congo RD vs Colombia
2026-06-18T00:00:00Z | Ghana vs Panamá
2026-06-18T03:00:00Z | Colombia vs Congo RD
2026-06-24T17:00:00Z | Croacia vs Colombia
2026-06-24T21:00:00Z | Panamá vs Congo RD
2026-06-28T22:00:00Z | Croacia vs Ghana
2026-06-28T22:00:00Z | Colombia vs Panamá
`;

async function applyRealSchedules() {
  console.log("⚽ Obteniendo partidos actuales de la base de datos...");
  const { data: dbMatches, error } = await supabase
    .from('matches')
    .select('id, home_team, away_team');

  if (error) {
    console.error("❌ Error conectando a Supabase:", error.message);
    return;
  }

  const lines = rawMatches.trim().split('\n');
  let successCount = 0;
  let notFoundCount = 0;

  for (const line of lines) {
    const [utcDate, teamsPart] = line.split(' | ');
    const [teamA_es, teamB_es] = teamsPart.split(' vs ');

    const teamA_en = teamNamesMap[teamA_es.trim()];
    const teamB_en = teamNamesMap[teamB_es.trim()];

    if (!teamA_en || !teamB_en) {
      console.warn(`⚠️ Cuidado: No se encontró traducción para ${teamA_es} o ${teamB_es}`);
      continue;
    }

    // Buscar en DB ignorando el orden de local/visitante
    const matchInDb = dbMatches.find(m => 
      (m.home_team === teamA_en && m.away_team === teamB_en) ||
      (m.home_team === teamB_en && m.away_team === teamA_en)
    );

    if (matchInDb) {
      const { error: updateErr } = await supabase
        .from('matches')
        .update({ kickoff_at: utcDate.trim() })
        .eq('id', matchInDb.id);

      if (updateErr) {
        console.error(`❌ Error actualizando partido ${teamA_en} vs ${teamB_en}:`, updateErr.message);
      } else {
        console.log(`✅ ${teamA_en} vs ${teamB_en} -> ${utcDate.trim()}`);
        successCount++;
      }
    } else {
      console.warn(`⚠️ No se encontró en la BD el partido: ${teamA_en} vs ${teamB_en}`);
      notFoundCount++;
    }
  }

  console.log(`\n🎉 PROCESO FINALIZADO`);
  console.log(`✅ Actualizados exitosamente: ${successCount} partidos`);
  if (notFoundCount > 0) {
    console.log(`⚠️ Partidos no encontrados en BD: ${notFoundCount}`);
  }
}

applyRealSchedules();
