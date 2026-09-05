/* KGC → KGCNA SIN RECARGAR LA PÁGINA.

   Es el caso que importa porque es el único en que la caché sobrevive: el
   queryClient se crea a nivel de módulo, así que una recarga lo vacía sola y
   esconde el problema. Cambiando de cuenta dentro de la misma pestaña, con
   staleTime de 5 minutos y refetchOnWindowFocus apagado, lo que quedó de la
   persona anterior se sigue pintando.

   Se mira `ranking_global` porque su respuesta está armada para quien
   pregunta: marca `soy_yo` en tu fila y, si quedás fuera del top, te agrega
   igual. Compartir esa entrada entre cuentas pone el "(vos)" en la persona
   equivocada. */
import { expect, test } from '@playwright/test'
import { sinRedExterna } from './apoyo.js'

const KGC = { id: '11111111-1111-4111-8111-111111111111', nombre: 'KGC', puntos: 140 }
const KGCNA = { id: '22222222-2222-4222-8222-222222222222', nombre: 'KGCNA', puntos: 37 }
const CLAVE = 'sb-pruebas-auth-token'


/* Hay dos botones "Cerrar sesión": el del sidebar —que en móvil vive fuera de
   pantalla— y el del perfil. Se toca el que la persona puede tocar. */
/* Quién aparece marcado como "(vos)" en el ranking.

   Se saca el NOMBRE pegado al marcador y se compara exacto. Regexear el texto
   suelto no sirve: "KGCNA" contiene "KGC", y un comodín entre medio cruza de
   una fila a la otra. Devuelve también cuántos "(vos)" hay: tiene que haber
   exactamente uno. */
async function quienEstaMarcado (page) {
  const texto = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
  return { nombre: (texto.match(/([^\s]+) \(vos\)/) || [])[1] ?? null,
           cuantos: (texto.match(/\(vos\)/g) || []).length }
}

async function cerrarSesion (page) {
  const botones = page.getByRole('button', { name: 'Cerrar sesión' })
  const vp = page.viewportSize()
  const alAlcance = async () => {
    for (let i = 0; i < await botones.count(); i++) {
      const caja = await botones.nth(i).boundingBox()
      if (caja && caja.x >= 0 && caja.x + caja.width <= vp.width) return i
    }
    return -1
  }
  let i = -1
  await expect.poll(async () => { i = await alAlcance(); return i }, { timeout: 15000 }).toBeGreaterThanOrEqual(0)
  await botones.nth(i).click()
}

const sesionDe = (u) => ({
  access_token: `token-${u.id}`, refresh_token: `refresh-${u.id}`, token_type: 'bearer',
  expires_at: Math.floor(Date.now() / 1000) + 31536000, expires_in: 31536000,
  user: { id: u.id, email: `${u.nombre.toLowerCase()}@prueba.test`,
    email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: { display_name: u.nombre },
    aud: 'authenticated', role: 'authenticated' },
})

// El ranking que devolvería la base para cada quien: `soy_yo` en su propia fila.
const rankingPara = (yo) => [KGC, KGCNA].map((u, i) => ({
  pos: i + 1, user_id: u.id, display_name: u.nombre, avatar_url: null,
  puntos: u.puntos, quinielas: 1, soy_yo: u.id === yo.id,
}))

test('al cambiar de cuenta sin recargar, el ranking deja de decir que sos el anterior', async ({ page }) => {
  let actual = KGC
  await sinRedExterna(page)
  await page.addInitScript(([clave, sesion]) => {
    try { localStorage.setItem(clave, JSON.stringify(sesion)) } catch { /* modo privado */ }
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    localStorage.setItem('qm_theme', 'dark')
    localStorage.setItem('tico:invitacion', 'CODIGODEKGC')
    // Si la página se recarga, este script corre de nuevo y la marca cambia.
    window.__marca = Math.random().toString(36).slice(2)
  }, [CLAVE, sesionDe(KGC)])

  await page.route('**://pruebas.supabase.co/**', async (route) => {
    const req = route.request(); const u = req.url()
    const dar = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
    // El login de KGCNA: devolvemos SU sesión, como haría GoTrue.
    if (u.includes('/auth/v1/token')) { actual = KGCNA; return dar({ ...sesionDe(KGCNA), ...sesionDe(KGCNA) }) }
    if (u.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' })
    if (u.includes('/rpc/ranking_global')) return dar(rankingPara(actual))
    if (u.includes('/rpc/mi_resumen_global')) return dar({ puntos: actual.puntos, partidos: 10, pos: 1 })
    if (u.includes('/rpc/my_groups')) return dar([])
    if (u.includes('/rest/v1/users')) {
      const cuerpo = { id: actual.id, display_name: actual.nombre, avatar_url: null,
        total_points: actual.puntos, points_adjustment: 0, is_admin: false,
        created_at: '2026-01-01', updated_at: '2026-01-01' }
      return (req.headers()['accept'] || '').includes('vnd.pgrst.object') ? dar(cuerpo) : dar([cuerpo])
    }
    return dar([])
  })

  // ── Con KGC: se abre el ranking y su fila queda marcada como propia ──
  await page.goto('/')
  await expect(page.getByText(`Hola, ${KGC.nombre}`, { exact: false })).toBeVisible()
  const marca = await page.evaluate(() => window.__marca)
  await page.getByRole('button', { name: 'Ver el ranking global' }).click()
  await expect(page.getByText('(vos)').first()).toBeVisible()
  // OJO: "KGCNA" CONTIENE "KGC", así que un toContain/not.toContain sobre el
  // texto suelto no distingue nada. Hay que anclar el "(vos)" a su fila.
  expect(await quienEstaMarcado(page)).toEqual({ nombre: KGC.nombre, cuantos: 1 })

  // ── Cambio de cuenta SIN recargar ──
  await page.getByRole('link', { name: 'Perfil' }).last().click()
  await expect(page).toHaveURL(/\/profile/)
  await cerrarSesion(page)
  await expect(page).toHaveURL(/\/auth/)
  await page.fill('#login-email', 'kgcna@prueba.test')
  await page.fill('#login-password', 'clave-de-prueba')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText(`Hola, ${KGCNA.nombre}`, { exact: false })).toBeVisible({ timeout: 15000 })

  // Ni una recarga en todo el camino: si la hubo, la caché se habría vaciado
  // sola y la prueba no habría probado nada.
  expect(await page.evaluate(() => window.__marca)).toBe(marca)

  await page.getByRole('button', { name: 'Ver el ranking global' }).click()
  // El marcador tiene que haberse MUDADO, no duplicado ni quedado en KGC.
  expect(await quienEstaMarcado(page)).toEqual({ nombre: KGCNA.nombre, cuantos: 1 })
})

test('los datos de la persona se borran al cambiar de cuenta, los del aparato no', async ({ page }) => {
  await sinRedExterna(page)
  await page.addInitScript(([clave, sesion]) => {
    try { localStorage.setItem(clave, JSON.stringify(sesion)) } catch { /* modo privado */ }
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('tico:invitacion', 'CODIGODEKGC')
    localStorage.setItem('qm_theme', 'dark')
    localStorage.setItem('pwaPromptDismissed', 'true')
  }, [CLAVE, sesionDe(KGC)])
  await page.route('**://pruebas.supabase.co/**', (route) => {
    const u = route.request().url()
    if (u.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/')
  await page.waitForTimeout(1500)
  await page.getByRole('link', { name: 'Perfil' }).last().click()
  await expect(page).toHaveURL(/\/profile/)
  await cerrarSesion(page)
  await expect(page).toHaveURL(/\/auth/)

  const guardado = await page.evaluate(() => ({
    tutorial: localStorage.getItem('tutorial_seen'),
    invitacion: localStorage.getItem('tico:invitacion'),
    tema: localStorage.getItem('qm_theme'),
    pwa: localStorage.getItem('pwaPromptDismissed'),
  }))
  expect(guardado.tutorial).toBeNull()     // de la persona
  expect(guardado.invitacion).toBeNull()   // de la persona
  expect(guardado.tema).toBe('dark')       // del aparato
  expect(guardado.pwa).toBe('true')        // del aparato
})

test('la invitación abierta sin sesión sobrevive al login y une a la cuenta que entra', async ({ page }) => {
  const liga = '33333333-3333-4333-8333-333333333333'
  const uniones = []
  await sinRedExterna(page)
  await page.addInitScript(() => {
    localStorage.setItem('pwaPromptDismissed', 'true')
    window.__marca = Math.random().toString(36).slice(2)
  })
  await page.route('**://pruebas.supabase.co/**', async route => {
    const req = route.request()
    const url = req.url()
    const dar = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.includes('/auth/v1/token')) return dar(sesionDe(KGCNA))
    if (url.includes('/rpc/join_group_by_code')) {
      uniones.push({ cuerpo: req.postDataJSON(), authorization: req.headers().authorization })
      return dar({ id: liga })
    }
    if (url.includes('/rpc/my_groups')) return dar([{ id: liga, name: 'Invitación de prueba', tournament_id: 1, tournament_name: 'Torneo', tournament_kind: 'league', rules_accepted: true }])
    if (url.includes('/rpc/mi_resumen_global')) return dar({ partidos: 0, puntos: 0 })
    if (url.includes('/rest/v1/users')) {
      const perfil = { id: KGCNA.id, display_name: KGCNA.nombre, total_points: 0, is_admin: false, avatar_url: null }
      return dar((req.headers().accept || '').includes('vnd.pgrst.object') ? perfil : [perfil])
    }
    return dar([])
  })
  await page.goto('/unirse/nueva123')
  await expect(page).toHaveURL(/\/auth$/)
  expect(await page.evaluate(() => localStorage.getItem('tico:invitacion'))).toBe('NUEVA123')
  const marca = await page.evaluate(() => window.__marca)
  await page.fill('#login-email', 'kgcna@prueba.test')
  await page.fill('#login-password', 'clave-de-prueba')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/q/${liga}$`))
  expect(uniones).toEqual([{ cuerpo: { p_code: 'NUEVA123' }, authorization: `Bearer token-${KGCNA.id}` }])
  expect(await page.evaluate(() => localStorage.getItem('tico:invitacion'))).toBeNull()
  expect(await page.evaluate(() => window.__marca)).toBe(marca)
})
