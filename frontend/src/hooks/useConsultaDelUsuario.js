import { useQuery } from '@tanstack/react-query'
import { useAuth } from './useAuth'

/* useQuery para las consultas cuya RESPUESTA DEPENDE DE QUIÉN PREGUNTA.

   Trece de las RPC que llama el frontend miran `auth.uid()` por dentro
   (comprobado leyendo `prosrc` en producción, no el repo). Varias además
   devuelven un `soy_yo` o te agregan TU fila aunque quedes fuera del top. Esas
   respuestas están armadas para una persona y no se pueden compartir entre
   cuentas.

   EL ID VA AL FINAL, NO AL PRINCIPIO. `invalidateQueries` compara por prefijo:
   con el id adelante, los `invalidateQueries({ queryKey: ['my_groups'] })` que
   ya existen dejarían de encontrar nada y la pantalla no se refrescaría al
   crear o abandonar una quiniela. Al final, siguen coincidiendo.

   Esto es defensa en profundidad, no la garantía: la garantía es vaciar la
   caché al cambiar de cuenta (`useCambioDeCuenta`), que también cubre la
   consulta que alguien agregue mañana sin acordarse de usar este hook. */
export function useConsultaDelUsuario({ queryKey, ...resto }) {
  const { user } = useAuth()
  return useQuery({ ...resto, queryKey: [...queryKey, user?.id ?? null] })
}

export default useConsultaDelUsuario
