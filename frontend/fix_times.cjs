require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, kickoff_at, phase')
    .in('phase', ['round_of_32', 'round_of_16', 'quarter_finals', 'semi_finals', 'third_place', 'final']);

  if (error) {
    console.error('Error fetching matches:', error);
    return;
  }

  console.log(`Found ${matches.length} knockout matches.`);

  let updatedCount = 0;
  for (const match of matches) {
    const currentDate = new Date(match.kickoff_at.endsWith('Z') ? match.kickoff_at : match.kickoff_at + 'Z');
    
    // Si la hora es muy temprano (ej: 13:00, 16:00 UTC), significa que no han sido ajustadas.
    // Sumaremos 4 horas a todas para que tengan un horario estandar de America
    const newDate = new Date(currentDate.getTime() + 4 * 60 * 60 * 1000);
    const newKickoffAt = newDate.toISOString();

    const { error: updateError } = await supabase
      .from('matches')
      .update({ kickoff_at: newKickoffAt })
      .eq('id', match.id);

    if (updateError) {
      console.error(`Error updating match ${match.id}:`, updateError);
    } else {
      updatedCount++;
    }
  }

  console.log(`Successfully updated ${updatedCount} matches. Added 4 hours to kickoff times.`);
}

run();
