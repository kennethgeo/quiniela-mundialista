/* Orden del lote al guardar una jornada completa de un saque.

   EL ORDEN NO ES COSMÉTICO. El trigger check_powerup_limit corre fila por fila
   DENTRO del mismo INSERT y sí ve las filas anteriores del lote. Verificado
   contra Postgres 16 con el trigger real (migración 53):

     [apagar A, prender B]  → guarda bien
     [prender B, apagar A]  → ERROR 'Límite de comodines x2 alcanzado'

   …aunque el estado final sea idéntico y respete el cupo. Y como el lote es
   atómico, ese error no pierde solo el comodín: no se guarda NADA, ni siquiera
   los marcadores que la persona acaba de llenar.

   Por eso las desactivaciones van siempre primero. Vive acá, aparte del
   componente, para poder probarlo sin arrastrar el cliente de Supabase. */
export function ordenarLote(filas) {
  return [...filas].sort((a, b) => Number(a.use_powerup_x2) - Number(b.use_powerup_x2))
}
