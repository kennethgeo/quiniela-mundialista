import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { limpiarDatosDeSesion } from '../lib/sesionLocal'

/* Vacía la caché cuando cambia quién está adentro.

   POR QUÉ NO ALCANZA CON PONER EL user_id EN CADA queryKey: alcanza mientras
   nadie se olvide de una. Este repo ya vivió esa clase de error —la fórmula
   del total global escrita dos veces, y una copia se olvidó de los puntos de
   asistidor durante meses—, y acá el olvido no se ve: la pantalla muestra
   datos de otra persona sin fallar. Así que las claves llevan el user_id
   ADEMÁS de esto, no en lugar de esto. Esto es lo que cubre la consulta que
   alguien agregue mañana sin acordarse.

   El queryClient vive fuera del árbol y no se recrea al cambiar de cuenta, así
   que sin vaciarlo la caché de la persona anterior sobrevive hasta 5 minutos
   (staleTime) — y con refetchOnWindowFocus apagado, ni siquiera se refresca al
   volver a la pestaña.

   Se limpia al SALIR, no solo al entrar: si no, entre una sesión y la
   siguiente los datos quedan ahí, listos para pintarse un instante antes de
   que llegue la primera respuesta de la cuenta nueva. */
export function useCambioDeCuenta() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const anterior = useRef(null)

  useEffect(() => {
    const actual = user?.id ?? null
    if (actual === anterior.current) return

    // Solo si ANTES había alguien. En el primer inicio de sesión no hay nada
    // que arrastrar, y vaciar ahí tiraría las consultas recién lanzadas.
    if (anterior.current !== null) {
      queryClient.clear()
      limpiarDatosDeSesion()
    }
    anterior.current = actual
  }, [user?.id, queryClient])
}

export default function CambioDeCuenta() {
  useCambioDeCuenta()
  return null
}
