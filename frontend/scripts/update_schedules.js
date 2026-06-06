import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno desde .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// IMPORTANTE: Asegúrate de poner tu SUPABASE_SERVICE_ROLE_KEY o la clave secreta aquí
// para poder sobreescribir la base de datos saltándote el RLS.
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('example.supabase.co')) {
  console.error("❌ ERROR: Debes configurar VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el archivo frontend/.env.local con tus claves reales.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Horarios de los partidos en Hora Central de México (UTC-6)
// Convertidos a UTC para guardarlos correctamente en la BD
const DAILY_SLOTS_UTC = [
  '16:00:00Z', // 10:00 AM CDMX
  '19:00:00Z', // 13:00 PM CDMX
  '22:00:00Z', // 16:00 PM CDMX
  '01:00:00Z', // 19:00 PM CDMX (Técnicamente es al día siguiente en UTC, pero lo manejamos sumando 1 día si es necesario)
];

async function updateSchedules() {
  console.log("⚽ Obteniendo partidos de la base de datos...");
  
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, kickoff_at')
    .order('kickoff_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error("❌ Error obteniendo partidos:", error.message);
    return;
  }

  console.log(`Encontrados ${matches.length} partidos. Re-programando horarios...`);

  // Fecha de inicio oficial del Mundial: 11 de Junio de 2026
  let currentDate = new Date('2026-06-11T00:00:00Z');
  let slotIndex = 1; // El partido inaugural suele ser al mediodía (13:00 local -> slot 1)

  let updatesCount = 0;

  for (const match of matches) {
    const slotTime = DAILY_SLOTS_UTC[slotIndex];
    
    // Si el slot es el de las 19:00 local (01:00 UTC), significa que la fecha UTC ya cruzó la medianoche,
    // así que necesitamos agregar un día al currentDate para el formato UTC correcto de la hora de la tarde, 
    // pero para mantenerlo simple sumaremos las horas a la fecha base.
    
    let baseDateStr = currentDate.toISOString().split('T')[0];
    
    // Excepción: si el slot es 01:00:00Z (que corresponde a las 19:00 hrs locales del mismo currentDate),
    // el UTC de ese partido ya pertenece al día calendario de UTC siguiente.
    if (slotTime === '01:00:00Z') {
      let nextDay = new Date(currentDate);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      baseDateStr = nextDay.toISOString().split('T')[0];
    }

    const newKickoffAt = `${baseDateStr}T${slotTime}`;

    // Actualizar en BD
    const { error: updateError } = await supabase
      .from('matches')
      .update({ kickoff_at: newKickoffAt })
      .eq('id', match.id);

    if (updateError) {
      console.error(`❌ Error actualizando partido ${match.id}:`, updateError.message);
    } else {
      console.log(`✅ Partido ${match.id} reprogramado a -> ${newKickoffAt} (UTC)`);
      updatesCount++;
    }

    // Avanzar al siguiente slot
    slotIndex++;
    if (slotIndex >= DAILY_SLOTS_UTC.length) {
      slotIndex = 0;
      // Avanzar al siguiente día
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
  }

  console.log(`\n🎉 ¡Listo! Se corrigieron ${updatesCount} horarios en UTC.`);
  console.log(`Al renderizarse en tu navegador, React usará la zona horaria de tu computadora automáticamente.`);
}

updateSchedules();
