/* Entrar a una quiniela desde un enlace: /unirse/ABC123

   El código se guarda ANTES de mirar si hay sesión, porque quien no tiene
   cuenta se va a registrar y a confirmar el correo, y ese viaje pierde la URL.
   Al volver, HubPage encuentra el código pendiente y termina el trabajo.

   Esta ruta NO va dentro de ProtectedRoute: si estuviera, el redirect a /auth
   ocurriría antes de que pudiéramos guardar nada y el enlace solo serviría
   para quien ya tiene la sesión abierta — justo quien no lo necesita. */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Loader2, AlertTriangle, Ticket } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { joinGroupByCode } from '../lib/groups'
import { guardarInvitacion, normalizarCodigo, tomarInvitacion } from '../lib/invitacion'

export default function UnirsePage() {
  const { codigo } = useParams()
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [error, setError] = useState(null)
  const yaIntentado = useRef(false)

  useEffect(() => {
    const limpio = normalizarCodigo(codigo)
    if (!limpio) { setError('Ese enlace no trae un código válido.'); return }

    // Se guarda siempre, haya sesión o no: si la hay se consume enseguida, y
    // si no, sobrevive al registro y a la verificación del correo.
    guardarInvitacion(limpio)

    if (loading) return
    if (!user) { navigate('/auth', { replace: true }); return }

    // React monta dos veces en desarrollo (StrictMode); sin esta guarda se
    // llamaría a join_group_by_code dos veces por cada visita.
    if (yaIntentado.current) return
    yaIntentado.current = true

    ;(async () => {
      try {
        const res = await joinGroupByCode(tomarInvitacion() || limpio)
        const id = res?.id ?? res?.league_id ?? (Array.isArray(res) ? res[0]?.id : null)
        navigate(id ? `/q/${id}` : '/', { replace: true })
      } catch (e) {
        // Puede ser un código que no existe, o que ya seas miembro. En los dos
        // casos el hub es mejor destino que una pantalla muerta.
        setError(e?.message || 'No se pudo entrar con ese enlace.')
      }
    })()
  }, [codigo, user, loading, navigate])

  return (
    <div className="min-h-dvh bg-primary flex items-center justify-center px-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="glass-card p-7 max-w-sm w-full text-center">
        {error ? (
          <>
            <AlertTriangle size={30} className="mx-auto text-[#FF7A59] mb-3" />
            <h2 className="font-bold font-['Archivo'] text-[15px] text-slate-900 dark:text-[#F3F1EA] mb-1.5">
              No se pudo usar el enlace
            </h2>
            <p className="text-[12.5px] text-[var(--text-muted,#8A8A8A)] mb-5">{error}</p>
            <button onClick={() => navigate('/', { replace: true })}
              className="w-full rounded-xl py-2.5 font-['Archivo'] font-bold text-[12.5px]"
              style={{ background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
              Ir a mis quinielas
            </button>
          </>
        ) : (
          <>
            <Ticket size={30} className="mx-auto text-accent mb-3" />
            <h2 className="font-bold font-['Archivo'] text-[15px] text-slate-900 dark:text-[#F3F1EA] mb-1.5">
              Entrando a la quiniela
            </h2>
            <p className="text-[12.5px] text-[var(--text-muted,#8A8A8A)] flex items-center justify-center gap-2">
              <Loader2 size={13} className="animate-spin" /> Un momento…
            </p>
          </>
        )}
      </motion.div>
    </div>
  )
}
