import { describe, expect, it } from 'vitest'
import {
  conAbonos, convertirReparto, detalleDe, estadoDe, etiquetaDe, faltaDe, montoDelAviso, opcionesDeMonto,
  repartoDe, repartoParaGuardar, resumen, textoParaCompartir, validarMonto,
} from './pozo'

/* Las filas tienen la forma de `league_pozo` con la migración 110 (y sin ella,
   para el caso de que el frontend llegue antes que la migración). */
const pagado = { confirmado: true, monto: 10000, falta: 0, al_dia: true, estado: 'pagado', aviso: false }
const parcial = { confirmado: true, monto: 5000, falta: 5000, al_dia: false, estado: 'parcial', aviso: false }
const pendienteConAviso = { confirmado: false, monto: null, falta: 10000, al_dia: false, estado: 'pendiente', aviso: true, aviso_monto: 5000 }
const viejoAvisado = { confirmado: false, aviso: true }

describe('estado y montos de cada persona', () => {
  it('usa el estado que manda la base', () => {
    expect(estadoDe(parcial)).toBe('parcial')
    expect(estadoDe(pagado)).toBe('pagado')
  })

  it('sin la 110 cae a pagó / pendiente', () => {
    expect(estadoDe({ confirmado: true })).toBe('pagado')
    expect(estadoDe(viejoAvisado)).toBe('pendiente')
    expect(faltaDe(viejoAvisado, 10000)).toBe(10000)
    expect(faltaDe({ confirmado: true }, 10000)).toBe(0)
  })

  it('un aviso sin monto es «lo que falta»', () => {
    expect(montoDelAviso(pendienteConAviso, 10000)).toBe(5000)
    expect(montoDelAviso({ ...parcial, aviso: true, aviso_monto: null }, 10000)).toBe(5000)
  })

  it('la etiqueta y el detalle dicen lo que hay, con montos', () => {
    expect(etiquetaDe(pagado, 'CRC')).toEqual({ tipo: 'pagado', texto: 'pagó' })
    expect(etiquetaDe(parcial, 'CRC').tipo).toBe('parcial')
    expect(etiquetaDe(parcial, 'CRC').texto).toMatch(/5.?000/)
    expect(etiquetaDe(pendienteConAviso, 'CRC')).toEqual({ tipo: 'aviso', texto: 'avisó' })
    expect(detalleDe(parcial, 10000, 'CRC')).toMatch(/de ₡10.?000 · falta ₡5.?000/)
    expect(detalleDe(pendienteConAviso, 10000, 'CRC')).toMatch(/avisó ₡5.?000 · falta confirmar/)
    // Un aviso viejo de alguien al día no se muestra.
    expect(detalleDe({ ...pagado, aviso: true }, 10000, 'CRC')).toBe('')
  })
})

describe('qué montos se ofrecen', () => {
  it('a quien no pagó nada: la cuota completa y la mitad', () => {
    expect(opcionesDeMonto({ cuota: 10000, falta: 10000 })).toEqual([
      { clave: 'todo', etiqueta: 'La cuota completa', monto: 10000 },
      { clave: 'mitad', etiqueta: 'La mitad', monto: 5000 },
    ])
  })

  it('a quien pagó la mitad: solo lo que falta (la mitad sería lo mismo)', () => {
    expect(opcionesDeMonto({ cuota: 10000, falta: 5000 })).toEqual([
      { clave: 'todo', etiqueta: 'Lo que falta', monto: 5000 },
    ])
  })

  it('nunca más de lo que falta, y nada si ya está al día', () => {
    expect(opcionesDeMonto({ cuota: 10000, falta: 3000 }).every((o) => o.monto <= 3000)).toBe(true)
    expect(opcionesDeMonto({ cuota: 10000, falta: 0 })).toEqual([])
  })
})

describe('un monto escrito a mano', () => {
  it('acepta un número dentro de lo que falta', () => {
    expect(validarMonto('3000', 5000, 'CRC')).toEqual({ monto: 3000 })
    expect(validarMonto(' 12.5 ', 20, 'USD')).toEqual({ monto: 12.5 })
  })

  it('rechaza vacío, cero, negativo, texto y pasarse', () => {
    expect(validarMonto('', 5000).error).toBeTruthy()
    expect(validarMonto('0', 5000).error).toMatch(/mayor que cero/)
    expect(validarMonto('-1', 5000).error).toMatch(/mayor que cero/)
    expect(validarMonto('abc', 5000).error).toMatch(/mayor que cero/)
    expect(validarMonto('6000', 5000, 'CRC').error).toMatch(/Falta ₡5.?000/)
  })
})

describe('el resumen del encabezado', () => {
  it('con la 110 usa al_dia y faltan de la base', () => {
    const r = resumen({ miembros: 17, al_dia: 14, pagados: 15, pozo_total: 170000, recaudado: 145000, faltan: 25000 })
    expect(r).toMatchObject({ miembros: 17, alDia: 14, faltan: 25000 })
    expect(r.avance).toBeCloseTo(145000 / 170000)
  })

  it('sin la 110 cae a lo de antes', () => {
    const r = resumen({ miembros: 17, pagados: 14, pozo_total: 170000, recaudado: 140000 })
    expect(r).toMatchObject({ alDia: 14, faltan: 30000 })
    expect(conAbonos({ pagados: 14 })).toBe(false)
    expect(conAbonos({ al_dia: 14 })).toBe(true)
  })

  it('el pie de foto dice el pozo y lleva el enlace', () => {
    const t = textoParaCompartir({ moneda: 'CRC', miembros: 17, al_dia: 14, pozo_total: 170000, recaudado: 140000 },
      'Bundestica', 'https://app/q/1?tab=pozo')
    expect(t).toMatch(/^Pozo de Bundestica: ₡140.?000 de ₡170.?000 · 14 de 17 al día\nhttps:\/\/app\/q\/1\?tab=pozo$/)
  })
})

describe('el reparto de premios', () => {
  it('en montos fijos se muestra lo acordado, no un porcentaje del pozo', () => {
    const r = repartoDe({ pozo_total: 170000, reparto: [{ puesto: 2, monto: 50000 }, { puesto: 1, monto: 100000 }] })
    expect(r.modo).toBe('montos')
    expect(r.filas).toEqual([
      { puesto: 1, monto: 100000, porcentaje: null },
      { puesto: 2, monto: 50000, porcentaje: null },
    ])
    expect(r).toMatchObject({ suma: 150000, total: 170000, excede: false })
  })

  it('avisa si los montos pasan el pozo completo', () => {
    expect(repartoDe({ pozo_total: 100000, reparto: [{ puesto: 1, monto: 80000 }, { puesto: 2, monto: 30000 }] }).excede).toBe(true)
  })

  it('los porcentajes de antes se siguen pasando a plata con el pozo completo', () => {
    const r = repartoDe({ pozo_total: 170000, reparto: [{ puesto: 1, porcentaje: 65 }, { puesto: 2, porcentaje: 35 }] })
    expect(r.modo).toBe('porcentajes')
    expect(r.filas).toEqual([
      { puesto: 1, monto: 110500, porcentaje: 65 },
      { puesto: 2, monto: 59500, porcentaje: 35 },
    ])
    expect(r.excede).toBe(false)
  })

  it('sin reparto no hay filas', () => {
    expect(repartoDe({ pozo_total: 1000, reparto: null }).filas).toEqual([])
  })
})

describe('el editor del reparto', () => {
  it('guarda montos con el puesto según la fila', () => {
    expect(repartoParaGuardar(['100000', '50000', ''], 'montos')).toEqual({
      reparto: [{ puesto: 1, monto: 100000 }, { puesto: 2, monto: 50000 }],
    })
  })

  it('guarda porcentajes, y no deja pasar de 100', () => {
    expect(repartoParaGuardar(['60', '40'], 'porcentajes')).toEqual({
      reparto: [{ puesto: 1, porcentaje: 60 }, { puesto: 2, porcentaje: 40 }],
    })
    expect(repartoParaGuardar(['60', '50'], 'porcentajes').error).toMatch(/más de 100/)
  })

  it('un puesto vacío entre dos con premio es un error; todo vacío es sin reparto', () => {
    expect(repartoParaGuardar(['100000', '', '20000'], 'montos').error).toMatch(/2º quedó sin monto/)
    expect(repartoParaGuardar(['', ''], 'montos')).toEqual({ reparto: null })
    expect(repartoParaGuardar(['-5'], 'montos').error).toBeTruthy()
  })

  it('al cambiar de modo parte del equivalente con el pozo completo', () => {
    expect(convertirReparto(['65', '35'], 'montos', 170000)).toEqual(['110500', '59500'])
    expect(convertirReparto(['110500', '59500'], 'porcentajes', 170000)).toEqual(['65', '35'])
    expect(convertirReparto(['65'], 'montos', 0)).toEqual([''])
  })
})
