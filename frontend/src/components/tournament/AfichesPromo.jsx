/* Los afiches de la quiniela, para que un admin los baje y los mande al grupo.

   POR QUÉ ESTÁ ATADO A UN TORNEO: el arte es de la Champions —dice "36
   equipos", "8 jornadas" y lleva fotos de estadios europeos—, así que en el
   panel de Bundestica no pinta nada. En vez de mostrarlo en todas las
   quinielas, cada entrada declara a qué torneo pertenece.

   Para agregar los de otro torneo: poné los JPEG en `public/promo/` (uno
   grande y uno `-mini` para la vista previa) y sumá una entrada acá con su
   `tournament_id`.

   La vista previa usa la miniatura A PROPÓSITO: mostrar el archivo grande
   escalado por CSS haría que abrir el panel bajara 1,8 MB solo para verlos
   chiquitos. */
import { motion } from 'motion/react'
import { Download } from 'lucide-react'

const AFICHES = [
  {
    tournament_id: 6,           // UEFA Champions League 26/27
    titulo: 'Afiches de la quiniela',
    nota: 'Entrada ₡15.000 · reparto 60/30 y ₡10.000 al penúltimo',
    piezas: [
      { id: '9x16', etiqueta: '9:16', para: 'Estado / historias', dim: '2160×3840' },
      { id: '1x1', etiqueta: '1:1', para: 'Chat', dim: '2880×2880' },
      { id: '16x9', etiqueta: '16:9', para: 'Pantalla', dim: '3840×2160' },
    ],
  },
]

export default function AfichesPromo({ tournamentId }) {
  const grupo = AFICHES.find((a) => a.tournament_id === tournamentId)
  if (!grupo) return null

  return (
    <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4">
      <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">
        {grupo.titulo}
      </h3>
      <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-1 mb-3">{grupo.nota}</p>

      <div className="grid grid-cols-3 gap-2.5">
        {grupo.piezas.map((p) => (
          <motion.a key={p.id} whileTap={{ scale: 0.96 }}
            href={`/promo/champions-${p.id}.jpg`}
            download={`quiniela-champions-${p.id}.jpg`}
            className="group block rounded-xl overflow-hidden border border-slate-200 dark:border-[#262626] bg-slate-50 dark:bg-[#0C0C0C]">
            <div className="aspect-square overflow-hidden bg-black grid place-items-center">
              <img src={`/promo/champions-${p.id}-mini.jpg`} alt={`Afiche ${p.etiqueta}`}
                loading="lazy" className="w-full h-full object-contain" />
            </div>
            <div className="px-2 py-2">
              <div className="flex items-center gap-1 font-['JetBrains_Mono'] font-bold text-[10px] text-accent">
                <Download size={10} /> {p.etiqueta}
              </div>
              <div className="text-[9px] text-[var(--text-muted,#8A8A8A)] leading-tight mt-0.5">{p.para}</div>
              <div className="font-['JetBrains_Mono'] text-[8.5px] text-[var(--text-muted,#8A8A8A)] mt-0.5">{p.dim}</div>
            </div>
          </motion.a>
        ))}
      </div>

      <p className="text-[10px] text-[var(--text-muted,#8A8A8A)] mt-2.5">
        Tocá uno para descargarlo en tamaño completo.
      </p>
    </div>
  )
}
