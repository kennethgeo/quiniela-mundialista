import { describe, it, expect } from 'vitest'
import { normalizarEstadio, fotoDeEstadio } from './estadios'

/* Los nombres de esta lista NO son inventados: son los que ESPN devuelve de
   verdad en `venue.fullName`, sacados de los 145 partidos de la temporada 2026
   de la liga tica. La primera versión del mapa dedujo las claves de qué equipo
   juega dónde y falló en tres de once. */
const VENUES_REALES = {
  'Estadio Ricardo Saprissa': '/estadios/saprissa.jpg',
  'Alejandro Morera Soto': '/estadios/morera-soto.jpg',
  'Estadio Carlos Alvarado': '/estadios/carlos-alvarado.jpg',
  'Estadio José Rafael "Fello" Meza Ivankovich': '/estadios/fello-meza.jpg',
  'Estadio Carlos Ugalde Álvarez': '/estadios/carlos-ugalde.jpg',
  'Estadio Lito Pérez': '/estadios/lito-perez.jpg',
  'Estadio Municipal de Pérez Zeledón': '/estadios/perez-zeledon.jpg',
  'Estadio Puente Piedra': '/estadios/puente-piedra.jpg',
  'Estadio Edgardo Baltodano Briceño': '/estadios/baltodano.jpg',
  'Estadio José Joaquín "Colleya" Fonseca': '/estadios/colleya-fonseca.jpg',
  'Estadio Rafael Bolaños': '/estadios/rafael-bolanos.jpg',
}

describe('fotoDeEstadio con los nombres que manda ESPN', () => {
  for (const [venue, esperado] of Object.entries(VENUES_REALES)) {
    it(`encuentra la foto de ${venue}`, () => {
      expect(fotoDeEstadio(venue)).toBe(esperado)
    })
  }

  it('cubre el Nacional, que se usa cuando sancionan un estadio', () => {
    expect(fotoDeEstadio('Estadio Nacional de Costa Rica')).toBe('/estadios/nacional.jpg')
  })

  it('devuelve null si ESPN no manda estadio, que pasa de vez en cuando', () => {
    // Visto en 2 de los 145 partidos de la temporada.
    expect(fotoDeEstadio(null)).toBeNull()
    expect(fotoDeEstadio(undefined)).toBeNull()
    expect(fotoDeEstadio('')).toBeNull()
  })

  it('no inventa una foto para un estadio que no conocemos', () => {
    expect(fotoDeEstadio('Estadio Azteca')).toBeNull()
  })
})

describe('normalizarEstadio', () => {
  it('iguala las grafías del mismo estadio', () => {
    const esperado = 'estadio ricardo saprissa ayma'
    expect(normalizarEstadio('Estadio Ricardo Saprissa Aymá')).toBe(esperado)
    expect(normalizarEstadio('ESTADIO RICARDO SAPRISSA AYMA')).toBe(esperado)
    expect(normalizarEstadio('  Estadio   Ricardo  Saprissa   Aymá  ')).toBe(esperado)
  })

  it('quita la puntuación sin pegar las palabras', () => {
    // Este caso es real: ESPN manda las comillas alrededor de "Fello".
    expect(normalizarEstadio('Estadio José Rafael "Fello" Meza Ivankovich'))
      .toBe('estadio jose rafael fello meza ivankovich')
  })

  it('aguanta valores vacíos', () => {
    expect(normalizarEstadio(null)).toBe('')
    expect(normalizarEstadio('')).toBe('')
  })
})

/* Las 36 sedes de la fase de liga de la Champions, con los nombres LITERALES
   que devuelve ESPN. Se comprueban las que tienen foto y también las que no:
   una sede sin foto tiene que dar null, no colarse por una clave demasiado
   suelta de otro estadio. */
const CHAMPIONS_CON_FOTO = {
  'Allianz Arena': '/estadios/allianz-arena.jpg',
  'Aspmyra Stadion': '/estadios/aspmyra.jpg',
  'De Kuip': '/estadios/de-kuip.jpg',
  'Decathlon Arena - Stade Pierre-Mauroy': '/estadios/pierre-mauroy.jpg',
  'Estadio La Cartuja': '/estadios/cartuja.jpg',
  'Estadio de la Cerámica': '/estadios/ceramica.jpg',
  'Estádio do Dragão': '/estadios/dragao.jpg',
  'Etihad Stadium': '/estadios/etihad.jpg',
  'Fortuna Arena': '/estadios/fortuna-arena.jpg',
  'Giuseppe Sinigaglia': '/estadios/sinigaglia.jpg',
  'Jan Breydel Stadium': '/estadios/jan-breydel.jpg',
  'Národny Futbalovy Stadión': '/estadios/tehelne-pole.jpg',
  'OPAP Arena': '/estadios/opap-arena.jpg',
  'Old Trafford': '/estadios/old-trafford.jpg',
  'Olimpico': '/estadios/olimpico-roma.jpg',
  'Philips Stadion': '/estadios/philips.jpg',
  'RAMS Park': '/estadios/rams-park.jpg',
  'Raiffeisen Arena (Linz)': '/estadios/raiffeisen-linz.jpg',
  'Red Bull Arena': '/estadios/red-bull-leipzig.jpg',
  'Riyadh Air Metropolitano': '/estadios/metropolitano.jpg',
  'San Siro': '/estadios/san-siro.jpg',
  'Santiago Bernabéu': '/estadios/bernabeu.jpg',
  'Signal Iduna Park': '/estadios/signal-iduna.jpg',
  'Spotify Camp Nou': '/estadios/camp-nou.jpg',
  'Viking Stadion': '/estadios/viking-stadion.jpg',
  'Villa Park': '/estadios/villa-park.jpg',
  'Anfield': '/estadios/anfield.jpg',
  'Emirates Stadium': '/estadios/emirates.jpg',
  'Parc des Princes': '/estadios/parc-des-princes.jpg',
  'Stamford Bridge': '/estadios/stamford-bridge.jpg',
  'Stade Bollaert-Delelis': '/estadios/bollaert.jpg',
  'Stadio Diego Armando Maradona': '/estadios/maradona.jpg',
  'MHPArena': '/estadios/mhparena.jpg',
  'Ulker Stadyumu': '/estadios/ulker.jpg',
  'Estádio José Alvalade': '/estadios/alvalade.jpg',
  'Bank Respublika Stadium': '/estadios/bank-respublika.jpg',
}

describe('sedes de la Champions', () => {
  for (const [venue, esperado] of Object.entries(CHAMPIONS_CON_FOTO)) {
    it(`encuentra ${venue}`, () => expect(fotoDeEstadio(venue)).toBe(esperado))
  }

  it('cubre las 36 sedes de la fase de liga', () => {
    expect(Object.keys(CHAMPIONS_CON_FOTO)).toHaveLength(36)
  })

  it('un estadio que no es sede sigue dando null', () => {
    expect(fotoDeEstadio('Wembley Stadium')).toBeNull()
    expect(fotoDeEstadio('Estadio Azteca')).toBeNull()
  })

  it('ninguna sede europea pisa a una tica', () => {
    // 'nacional' es una clave muy suelta y el Národny eslovaco se le parece.
    expect(fotoDeEstadio('Národny Futbalovy Stadión')).toBe('/estadios/tehelne-pole.jpg')
    expect(fotoDeEstadio('Estadio Nacional de Costa Rica')).toBe('/estadios/nacional.jpg')
  })
})
