export async function cambiarNombre({ client, userId, anterior, nombre }) {
  const limpio = nombre.trim()
  if (limpio.length < 2 || limpio.length > 50) throw new Error('Usá entre 2 y 50 caracteres para tu nombre.')
  const { data, error } = await client.auth.getSession()
  if (error || !userId || data?.session?.user?.id !== userId) throw new Error('Tu sesión cambió. Recargá el perfil antes de guardar.')
  let query = client.from('users').update({ display_name: limpio }).eq('id', userId)
  query = anterior == null ? query.is('display_name', null) : query.eq('display_name', anterior)
  const result = await query.select('id,display_name').single()
  if (result.error || result.data?.id !== userId || result.data?.display_name !== limpio) {
    throw new Error('No pudimos confirmar el nombre. Recargá el perfil para comprobarlo; puede haber cambiado desde otro dispositivo.')
  }
  return limpio
}
