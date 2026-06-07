import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const teamNamesMap = {
  "Mexico": "Mexico",
  "Sudafrica": "South Africa",
  "República de Corea": "South Korea",
  "Chequia": "Czechia",
  "Catar": "Qatar",
  "Suiza": "Switzerland",
  "Brasil": "Brazil",
  "Marruecos": "Morocco",
  "Haiti": "Haiti",
  "Escocia": "Scotland",
  "Australia": "Australia",
  "Turquia": "Türkiye",
  "EE. UU.": "USA",
  "Paraguay": "Paraguay",
  "Alemania": "Germany",
  "Curazao": "Curaçao",
  "Costa de Marfil": "Ivory Coast",
  "Ecuador": "Ecuador",
  "Paises Bajos": "Netherlands",
  "Japon": "Japan",
  "Suecia": "Sweden",
  "Tunez": "Tunisia",
  "Belgica": "Belgium",
  "Egipto": "Egypt",
  "Arabia Saudi": "Saudi Arabia",
  "Uruguay": "Uruguay",
  "España": "Spain",
  "Islas de Cabo Verde": "Cape Verde",
  "Nueva Zelanda": "New Zealand",
  "RI de Iran": "Iran",
  "Francia": "France",
  "Senegal": "Senegal",
  "Noruega": "Norway",
  "Irak": "Iraq",
  "Argentina": "Argentina",
  "Austria": "Austria",
  "Argelia": "Algeria",
  "Jordania": "Jordan",
  "Portugal": "Portugal",
  "RD Congo": "DR Congo",
  "Inglaterra": "England",
  "Croacia": "Croatia",
  "Colombia": "Colombia",
  "Ghana": "Ghana",
  "Panama": "Panama",
  "Uzbekistan": "Uzbekistan",
  "Bosnia y Herzegovina": "Bosnia-Herzegovina",
  "Canada": "Canada"
};

const matchesData = [
  // Jueves 11 junio
  { date: '2026-06-11', time: '13:00', team1: 'Mexico', team2: 'Sudafrica' },
  { date: '2026-06-11', time: '20:00', team1: 'República de Corea', team2: 'Chequia' },
  // Viernes 12 junio
  { date: '2026-06-12', time: '19:00', team1: 'EE. UU.', team2: 'Paraguay' },
  // Sabado 13 junio
  { date: '2026-06-13', time: '13:00', team1: 'Catar', team2: 'Suiza' },
  { date: '2026-06-13', time: '16:00', team1: 'Brasil', team2: 'Marruecos' },
  { date: '2026-06-13', time: '19:00', team1: 'Haiti', team2: 'Escocia' },
  { date: '2026-06-13', time: '22:00', team1: 'Australia', team2: 'Turquia' },
  // Domingo 14 junio
  { date: '2026-06-14', time: '11:00', team1: 'Alemania', team2: 'Curazao' },
  { date: '2026-06-14', time: '14:00', team1: 'Paises Bajos', team2: 'Japon' },
  { date: '2026-06-14', time: '17:00', team1: 'Costa de Marfil', team2: 'Ecuador' },
  { date: '2026-06-14', time: '20:00', team1: 'Suecia', team2: 'Tunez' },
  // Lunes 15 junio
  { date: '2026-06-15', time: '10:00', team1: 'España', team2: 'Islas de Cabo Verde' },
  { date: '2026-06-15', time: '13:00', team1: 'Belgica', team2: 'Egipto' },
  { date: '2026-06-15', time: '16:00', team1: 'Arabia Saudi', team2: 'Uruguay' },
  { date: '2026-06-15', time: '19:00', team1: 'RI de Iran', team2: 'Nueva Zelanda' },
  // Martes 16 junio
  { date: '2026-06-16', time: '13:00', team1: 'Francia', team2: 'Senegal' },
  { date: '2026-06-16', time: '16:00', team1: 'Irak', team2: 'Noruega' },
  { date: '2026-06-16', time: '19:00', team1: 'Argentina', team2: 'Argelia' },
  { date: '2026-06-16', time: '22:00', team1: 'Austria', team2: 'Jordania' },
  // Miercoles 17 junio
  { date: '2026-06-17', time: '11:00', team1: 'Portugal', team2: 'RD Congo' },
  { date: '2026-06-17', time: '14:00', team1: 'Inglaterra', team2: 'Croacia' },
  { date: '2026-06-17', time: '17:00', team1: 'Ghana', team2: 'Panama' },
  { date: '2026-06-17', time: '20:00', team1: 'Uzbekistan', team2: 'Colombia' },
  // Jueves 18 junio
  { date: '2026-06-18', time: '10:00', team1: 'Chequia', team2: 'Sudafrica' },
  { date: '2026-06-18', time: '13:00', team1: 'Suiza', team2: 'Bosnia y Herzegovina' },
  { date: '2026-06-18', time: '16:00', team1: 'Canada', team2: 'Catar' },
  { date: '2026-06-18', time: '19:00', team1: 'Mexico', team2: 'República de Corea' },
  // Viernes 19 junio
  { date: '2026-06-19', time: '13:00', team1: 'EE. UU.', team2: 'Australia' },
  { date: '2026-06-19', time: '16:00', team1: 'Escocia', team2: 'Marruecos' },
  { date: '2026-06-19', time: '18:30', team1: 'Brasil', team2: 'Haiti' },
  { date: '2026-06-19', time: '21:00', team1: 'Turquia', team2: 'Paraguay' },
  // Sabado 20 junio
  { date: '2026-06-20', time: '11:00', team1: 'Paises Bajos', team2: 'Suecia' },
  { date: '2026-06-20', time: '14:00', team1: 'Alemania', team2: 'Costa de Marfil' },
  { date: '2026-06-20', time: '18:00', team1: 'Ecuador', team2: 'Curazao' },
  { date: '2026-06-20', time: '22:00', team1: 'Tunez', team2: 'Japon' },
  // Domingo 21 junio
  { date: '2026-06-21', time: '10:00', team1: 'España', team2: 'Arabia Saudi' },
  { date: '2026-06-21', time: '13:00', team1: 'Belgica', team2: 'RI de Iran' },
  { date: '2026-06-21', time: '16:00', team1: 'Uruguay', team2: 'Islas de Cabo Verde' },
  { date: '2026-06-21', time: '19:00', team1: 'Nueva Zelanda', team2: 'Egipto' },
  // Lunes 22 junio
  { date: '2026-06-22', time: '11:00', team1: 'Argentina', team2: 'Austria' },
  { date: '2026-06-22', time: '15:00', team1: 'Francia', team2: 'Irak' },
  { date: '2026-06-22', time: '18:00', team1: 'Noruega', team2: 'Senegal' },
  { date: '2026-06-22', time: '21:00', team1: 'Jordania', team2: 'Argelia' },
  // Martes 23 junio
  { date: '2026-06-23', time: '11:00', team1: 'Portugal', team2: 'Uzbekistan' },
  { date: '2026-06-23', time: '14:00', team1: 'Inglaterra', team2: 'Ghana' },
  { date: '2026-06-23', time: '17:00', team1: 'Panama', team2: 'Croacia' },
  { date: '2026-06-23', time: '20:00', team1: 'Colombia', team2: 'RD Congo' },
  // Miercoles 24 junio
  { date: '2026-06-24', time: '13:00', team1: 'Suiza', team2: 'Canada' },
  { date: '2026-06-24', time: '13:00', team1: 'Bosnia y Herzegovina', team2: 'Catar' },
  { date: '2026-06-24', time: '16:00', team1: 'Escocia', team2: 'Brasil' },
  { date: '2026-06-24', time: '16:00', team1: 'Marruecos', team2: 'Haiti' },
  { date: '2026-06-24', time: '19:00', team1: 'Chequia', team2: 'Mexico' },
  { date: '2026-06-24', time: '19:00', team1: 'Sudafrica', team2: 'República de Corea' },
  // Jueves 25 junio
  { date: '2026-06-25', time: '14:00', team1: 'Curazao', team2: 'Costa de Marfil' },
  { date: '2026-06-25', time: '14:00', team1: 'Ecuador', team2: 'Alemania' },
  { date: '2026-06-25', time: '17:00', team1: 'Japon', team2: 'Suecia' },
  { date: '2026-06-25', time: '17:00', team1: 'Tunez', team2: 'Paises Bajos' },
  { date: '2026-06-25', time: '20:00', team1: 'Turquia', team2: 'EE. UU.' },
  { date: '2026-06-25', time: '20:00', team1: 'Paraguay', team2: 'Australia' },
  // Viernes 26 junio
  { date: '2026-06-26', time: '13:00', team1: 'Noruega', team2: 'Francia' },
  { date: '2026-06-26', time: '13:00', team1: 'Senegal', team2: 'Irak' },
  { date: '2026-06-26', time: '18:00', team1: 'Islas de Cabo Verde', team2: 'Arabia Saudi' },
  { date: '2026-06-26', time: '18:00', team1: 'Uruguay', team2: 'España' },
  { date: '2026-06-26', time: '21:00', team1: 'Egipto', team2: 'RI de Iran' },
  { date: '2026-06-26', time: '21:00', team1: 'Nueva Zelanda', team2: 'Belgica' },
  // Sabado 27 junio
  { date: '2026-06-27', time: '15:00', team1: 'Panama', team2: 'Inglaterra' },
  { date: '2026-06-27', time: '15:00', team1: 'Croacia', team2: 'Ghana' },
  { date: '2026-06-27', time: '17:30', team1: 'Colombia', team2: 'Portugal' },
  { date: '2026-06-27', time: '17:30', team1: 'RD Congo', team2: 'Uzbekistan' },
  { date: '2026-06-27', time: '20:00', team1: 'Argelia', team2: 'Austria' },
  { date: '2026-06-27', time: '20:00', team1: 'Jordania', team2: 'Argentina' }
];

async function run() {
  console.log("Obteniendo partidos de Supabase...");
  const { data: dbMatches, error } = await supabase.from('matches').select('*').eq('phase', 'groups');
  if (error) return console.error(error);

  let updated = 0;
  for (const m of matchesData) {
    const t1_en = teamNamesMap[m.team1];
    const t2_en = teamNamesMap[m.team2];
    
    if (!t1_en || !t2_en) {
      console.error("No se encontro traduccion para", m.team1, "o", m.team2);
      continue;
    }

    const matchDb = dbMatches.find(dbm => 
      (dbm.home_team === t1_en && dbm.away_team === t2_en) ||
      (dbm.home_team === t2_en && dbm.away_team === t1_en)
    );

    if (matchDb) {
      // Create a Date object for Costa Rica time (UTC-6)
      const dateStr = `${m.date}T${m.time}:00-06:00`;
      const dateObj = new Date(dateStr);
      const utcIsoString = dateObj.toISOString();

      await supabase.from('matches').update({ kickoff_at: utcIsoString }).eq('id', matchDb.id);
      console.log(`✅ Actualizado: ${t1_en} vs ${t2_en} -> ${utcIsoString}`);
      updated++;
    } else {
      console.error(`❌ Partido no encontrado en DB: ${t1_en} vs ${t2_en}`);
    }
  }

  console.log(`Finalizado. Partidos actualizados: ${updated}/48`);
}

run();
