// Mapa de equipos del Mundial 2026 (nombre -> código de bandera flagcdn)
export const TEAMS_2026 = {
  Argentina: 'ar', Algeria: 'dz', Australia: 'au', Austria: 'at', Belgium: 'be',
  'Bosnia-Herzegovina': 'ba', Brazil: 'br', Canada: 'ca', 'Cape Verde': 'cv',
  Colombia: 'co', 'Costa Rica': 'cr', Croatia: 'hr', 'Curaçao': 'cw', Czechia: 'cz',
  Denmark: 'dk', 'DR Congo': 'cd', Ecuador: 'ec', Egypt: 'eg', England: 'gb-eng',
  France: 'fr', Germany: 'de', Ghana: 'gh', Haiti: 'ht', Iran: 'ir', Iraq: 'iq',
  Italy: 'it', 'Ivory Coast': 'ci', Japan: 'jp', Jordan: 'jo', Mexico: 'mx',
  Morocco: 'ma', Netherlands: 'nl', 'New Zealand': 'nz', Nigeria: 'ng', Norway: 'no',
  Panama: 'pa', Paraguay: 'py', Peru: 'pe', Portugal: 'pt', Qatar: 'qa',
  'Saudi Arabia': 'sa', Scotland: 'gb-sct', Senegal: 'sn', 'South Africa': 'za',
  'South Korea': 'kr', Spain: 'es', Sweden: 'se', Switzerland: 'ch', Tunisia: 'tn',
  'Türkiye': 'tr', USA: 'us', Uruguay: 'uy', Uzbekistan: 'uz',
}

export function teamCode(name) {
  return TEAMS_2026[name] || 'xx'
}
