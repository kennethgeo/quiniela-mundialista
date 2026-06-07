import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const knockoutMatches = [
  // Round of 32
  { id: 73, date: '2026-06-28', time: '13:00', team1: '2A', team2: '2B' },
  { id: 74, date: '2026-06-29', time: '11:00', team1: '1E', team2: '3A/B/C/D/F' },
  { id: 77, date: '2026-06-29', time: '14:30', team1: '1I', team2: '3C/D/F/G/H' },
  { id: 75, date: '2026-06-29', time: '19:00', team1: '1F', team2: '2C' },
  { id: 78, date: '2026-06-30', time: '11:00', team1: '2E', team2: '2I' },
  { id: 76, date: '2026-06-30', time: '15:00', team1: '1C', team2: '2F' },
  { id: 79, date: '2026-06-30', time: '19:00', team1: '1A', team2: '3C/E/F/H/I' },
  { id: 80, date: '2026-07-01', time: '10:00', team1: '1L', team2: '3E/H/I/J/K' },
  { id: 82, date: '2026-07-01', time: '14:00', team1: '1G', team2: '3A/E/H/I/J' },
  { id: 81, date: '2026-07-01', time: '18:00', team1: '1D', team2: '3B/E/F/I/J' },
  { id: 83, date: '2026-07-02', time: '13:00', team1: '2K', team2: '2L' },
  { id: 84, date: '2026-07-02', time: '17:00', team1: '1H', team2: '2J' },
  { id: 85, date: '2026-07-02', time: '21:00', team1: '1B', team2: '3E/F/G/I/J' },
  { id: 86, date: '2026-07-03', time: '12:00', team1: '1J', team2: '2H' },
  { id: 87, date: '2026-07-03', time: '16:00', team1: '1K', team2: '3D/E/I/J/L' },
  { id: 88, date: '2026-07-03', time: '19:30', team1: '2D', team2: '2G' },

  // Round of 16
  { id: 89, date: '2026-07-04', time: '11:00', team1: 'W73', team2: 'W75' },
  { id: 90, date: '2026-07-04', time: '15:00', team1: 'W74', team2: 'W77' },
  { id: 91, date: '2026-07-05', time: '14:00', team1: 'W78', team2: 'W79' },
  { id: 92, date: '2026-07-05', time: '18:00', team1: 'W76', team2: 'W80' },
  { id: 93, date: '2026-07-06', time: '13:00', team1: 'W83', team2: 'W84' },
  { id: 94, date: '2026-07-06', time: '18:00', team1: 'W81', team2: 'W82' },
  { id: 95, date: '2026-07-07', time: '10:00', team1: 'W86', team2: 'W88' },
  { id: 96, date: '2026-07-07', time: '14:00', team1: 'W85', team2: 'W87' },

  // Quarter Finals
  { id: 97, date: '2026-07-09', time: '15:00', team1: 'W89', team2: 'W90' },
  { id: 98, date: '2026-07-10', time: '15:00', team1: 'W93', team2: 'W94' },
  { id: 99, date: '2026-07-11', time: '14:00', team1: 'W91', team2: 'W92' },
  { id: 100, date: '2026-07-11', time: '18:00', team1: 'W95', team2: 'W96' },

  // Semi Finals
  { id: 101, date: '2026-07-14', time: '18:00', team1: 'W97', team2: 'W98' },
  { id: 102, date: '2026-07-15', time: '18:00', team1: 'W99', team2: 'W100' },

  // Third Place
  { id: 103, date: '2026-07-18', time: '18:00', team1: 'L101', team2: 'L102' },

  // Final
  { id: 104, date: '2026-07-19', time: '13:00', team1: 'W101', team2: 'W102' },
];

async function run() {
  console.log("Obteniendo partidos eliminatorios...");
  const { data: dbMatches, error } = await supabase.from('matches').select('*').neq('phase', 'groups');
  if (error) return console.error(error);

  let updated = 0;
  for (const m of knockoutMatches) {
    const dateStr = `${m.date}T${m.time}:00-06:00`;
    const dateObj = new Date(dateStr);
    const utcIsoString = dateObj.toISOString();

    const { error: updateError } = await supabase
      .from('matches')
      .update({
        kickoff_at: utcIsoString,
        home_team: m.team1,
        away_team: m.team2
      })
      .eq('id', m.id);

    if (updateError) {
      console.error(`❌ Error con id ${m.id}:`, updateError.message);
    } else {
      console.log(`✅ Actualizado M${m.id}: ${m.team1} vs ${m.team2} -> ${utcIsoString}`);
      updated++;
    }
  }

  console.log(`Finalizado. Partidos actualizados: ${updated}/${knockoutMatches.length}`);
}

run();
