import { useId, useState } from 'react'
import { CalendarDays, Download } from 'lucide-react'
import Button from '../ui/Button'
import { crearCalendario, partidosParaCalendario } from '../../lib/calendario'

export default function ExportarCalendario({ matches, shownMatches, group, jornada }) {
  const id = useId()
  const [alcance, setAlcance] = useState('seleccion')
  const [aviso, setAviso] = useState(null)
  const seleccion = alcance === 'todas' ? matches : shownMatches
  const cantidad = partidosParaCalendario(seleccion).length
  const descargar = () => {
    try {
      // Volver a filtrar al pulsar: un partido pudo empezar con el panel abierto.
      const resultado = crearCalendario({ matches: seleccion, group, origin: window.location.origin })
      const archivo = new Blob([resultado.contenido], { type: 'text/calendar;charset=utf-8' })
      const url = URL.createObjectURL(archivo)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `tico-games-${group.id}.ics`
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      // Dar tiempo al navegador para iniciar la descarga antes de liberar el Blob.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setAviso({ error: false, texto: 'Archivo preparado. Abrilo o importalo desde tu calendario.' })
    } catch (error) {
      setAviso({ error: true, texto: error.message || 'No pudimos preparar el calendario. Volvé a intentar.' })
    }
  }

  return (
    <details className="mb-4 rounded-xl border border-slate-200 bg-white dark:border-[#303030] dark:bg-[#161616]">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <CalendarDays size={16} aria-hidden="true" /> Llevar partidos a mi calendario
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Descargá los próximos partidos para importarlos en Google Calendar, Apple Calendar u otra app compatible.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">Partidos a incluir</label>
            <select id={id} value={alcance} onChange={e => { setAlcance(e.target.value); setAviso(null) }}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-[#202020] dark:text-slate-100">
              <option value="seleccion">{jornada && jornada !== '__all__' ? jornada : 'Selección actual'}</option>
              <option value="todas">Toda la quiniela</option>
            </select>
          </div>
          <Button variant="secondary" onClick={descargar} disabled={cantidad === 0}>
            <Download size={16} aria-hidden="true" />
            {cantidad ? `Descargar ${cantidad} ${cantidad === 1 ? 'partido' : 'partidos'} (.ics)` : 'Sin partidos próximos'}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          Solo horarios confirmados de partidos por jugar. No incluye predicciones ni códigos de invitación.
          Es una copia: los cambios de horario no se actualizan automáticamente. Google Calendar permite importar el archivo desde una computadora.
        </p>
        {aviso && <p role={aviso.error ? 'alert' : 'status'} className={`text-sm ${aviso.error ? 'text-rose-700 dark:text-rose-300' : 'text-teal-700 dark:text-teal-300'}`}>{aviso.texto}</p>}
      </div>
    </details>
  )
}
