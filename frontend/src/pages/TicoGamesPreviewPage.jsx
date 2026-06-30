import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../contexts/ThemeContext'

/**
 * MOCKUP — "Tico Games" (estilo arcade 8-bit)
 * Página de PREVIEW solo para admin. No usa datos reales ni toca el resto de la app.
 * Objetivo: ver el look & feel del rediseño en vivo (incluido el celular vía PWA)
 * antes de comprometernos. Todo aquí es de ejemplo.
 */

// ---- Datos de ejemplo (dummy) ----
const GROUPS = [
  { id: 1, name: 'La Mejenga del Barrio', tournament: 'Mundial 2026', kind: 'cup', members: 16, pos: 3, total: 16, points: 84, next: 'CRC vs BRA · hoy 7:00pm', color: 'magenta' },
  { id: 2, name: 'Liga de la Oficina', tournament: 'LaLiga', kind: 'league', members: 9, pos: 1, total: 9, points: 122, next: 'Madrid vs Barça · sáb', color: 'cyan' },
  { id: 3, name: 'Champions con los maes', tournament: 'Champions', kind: 'cup', members: 12, pos: 5, total: 12, points: 41, next: 'Octavos · mar', color: 'orange' },
  { id: 4, name: 'Primera Tica', tournament: 'Liga Tica', kind: 'league', members: 7, pos: 2, total: 7, points: 67, next: 'Saprissa vs Liga · dom', color: 'lime' },
]

const MATCHES = [
  { id: 1, home: 'CRC', away: 'BRA', homeFlag: '🇨🇷', awayFlag: '🇧🇷', time: 'HOY 7:00 PM', status: 'open', myH: 1, myA: 2, powerup: true },
  { id: 2, home: 'MEX', away: 'ARG', homeFlag: '🇲🇽', awayFlag: '🇦🇷', time: 'HOY 9:00 PM', status: 'open', myH: 0, myA: 1, powerup: false },
  { id: 3, home: 'ESP', away: 'GER', homeFlag: '🇪🇸', awayFlag: '🇩🇪', time: 'EN VIVO 67\'', status: 'live', myH: 2, myA: 2, liveH: 2, liveA: 1, powerup: false },
  { id: 4, home: 'FRA', away: 'POR', homeFlag: '🇫🇷', awayFlag: '🇵🇹', time: 'FINAL', status: 'done', myH: 1, myA: 1, liveH: 1, liveA: 1, earned: 3, powerup: false },
]

const STANDINGS = [
  { pos: 1, name: 'Karla', pts: 122, pj: 14, ac: 9 },
  { pos: 2, name: 'Vos (Kenneth)', pts: 118, pj: 14, ac: 8, me: true },
  { pos: 3, name: 'Diego', pts: 110, pj: 14, ac: 8 },
  { pos: 4, name: 'Mau', pts: 97, pj: 14, ac: 6 },
  { pos: 5, name: 'Fabi', pts: 89, pj: 14, ac: 6 },
  { pos: 6, name: 'José', pts: 81, pj: 14, ac: 5 },
]

const TABS = [
  { id: 'hub', label: 'MIS QUINIELAS' },
  { id: 'matches', label: 'PARTIDOS' },
  { id: 'table', label: 'TABLA' },
]

export default function TicoGamesPreviewPage() {
  const { profile } = useAuth()
  const { theme } = useTheme()
  const [tab, setTab] = useState('hub')
  const [mode, setMode] = useState(theme === 'dark' ? 'dark' : 'light')

  // Defensa en profundidad: solo admin
  if (profile && !profile.is_admin) return <Navigate to="/" replace />

  return (
    <div className={`tg-root tg-${mode}`}>
      <style>{TG_CSS}</style>

      {/* Aviso de preview */}
      <div className="tg-banner">★ PREVIEW SOLO ADMIN — mockup de estilo, datos de ejemplo ★</div>

      {/* Header / logo */}
      <header className="tg-header">
        <div className="tg-logo">
          <span className="tg-logo-mark">▶</span>
          <span className="tg-logo-text">TICO&nbsp;GAMES</span>
        </div>
        <div className="tg-header-right">
          <button
            className="tg-toggle"
            onClick={() => setMode(m => (m === 'dark' ? 'light' : 'dark'))}
            title="Alternar claro/oscuro"
          >
            {mode === 'dark' ? '☀ CLARO' : '☾ OSCURO'}
          </button>
          <div className="tg-coins">🪙 84</div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tg-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tg-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="tg-content">
        {tab === 'hub' && <HubView />}
        {tab === 'matches' && <MatchesView />}
        {tab === 'table' && <TableView />}
      </div>
    </div>
  )
}

function HubView() {
  return (
    <>
      <p className="tg-greet">¡Qué tal, mae! Estás en <b>4 quinielas</b>.</p>

      <div className="tg-grid">
        {GROUPS.map(g => (
          <div key={g.id} className={`tg-window tg-c-${g.color}`}>
            <div className="tg-titlebar">
              <span className="tg-titlebar-name">{g.name}</span>
              <span className="tg-titlebar-btns"><i>_</i><i>□</i><i>×</i></span>
            </div>
            <div className="tg-window-body">
              <div className="tg-badges">
                <span className="tg-chip">{g.tournament}</span>
                <span className="tg-chip tg-chip-ghost">{g.kind === 'cup' ? '🏆 Copa' : '📊 Liga'}</span>
              </div>
              <div className="tg-stat-row">
                <div className="tg-stat">
                  <span className="tg-stat-num">#{g.pos}</span>
                  <span className="tg-stat-lbl">de {g.total}</span>
                </div>
                <div className="tg-stat">
                  <span className="tg-stat-num">{g.points}</span>
                  <span className="tg-stat-lbl">pts</span>
                </div>
                <div className="tg-stat">
                  <span className="tg-stat-num">{g.members}</span>
                  <span className="tg-stat-lbl">maes</span>
                </div>
              </div>
              <div className="tg-next">⏭ {g.next}</div>
              <button className="tg-btn tg-btn-block">ENTRAR ▸</button>
            </div>
          </div>
        ))}
      </div>

      <div className="tg-actions">
        <button className="tg-btn tg-btn-primary">＋ CREAR QUINIELA</button>
        <button className="tg-btn">🔑 UNIRME POR CÓDIGO</button>
      </div>
    </>
  )
}

function MatchesView() {
  return (
    <div className="tg-window tg-c-cyan tg-window-wide">
      <div className="tg-titlebar">
        <span className="tg-titlebar-name">La Mejenga del Barrio · Partidos</span>
        <span className="tg-titlebar-btns"><i>_</i><i>□</i><i>×</i></span>
      </div>
      <div className="tg-window-body">
        {MATCHES.map(m => (
          <div key={m.id} className={`tg-match tg-match-${m.status}`}>
            <div className="tg-match-time">
              {m.status === 'live' && <span className="tg-live-dot" />}
              {m.time}
              {m.powerup && <span className="tg-powerup" title="Comodín x2">★ x2</span>}
              {m.status === 'done' && <span className="tg-earned">+{m.earned} pts</span>}
            </div>
            <div className="tg-match-row">
              <div className="tg-team">
                <span className="tg-flag">{m.homeFlag}</span>
                <span className="tg-team-name">{m.home}</span>
              </div>

              {/* Marcador / predicción — fuente LIMPIA (legible) */}
              <div className="tg-score">
                {m.status === 'open' ? (
                  <>
                    <input className="tg-score-input" defaultValue={m.myH} inputMode="numeric" />
                    <span className="tg-score-sep">:</span>
                    <input className="tg-score-input" defaultValue={m.myA} inputMode="numeric" />
                  </>
                ) : (
                  <>
                    <span className="tg-score-val">{m.liveH}</span>
                    <span className="tg-score-sep">:</span>
                    <span className="tg-score-val">{m.liveA}</span>
                  </>
                )}
              </div>

              <div className="tg-team">
                <span className="tg-team-name">{m.away}</span>
                <span className="tg-flag">{m.awayFlag}</span>
              </div>
            </div>
            {m.status !== 'open' && (
              <div className="tg-mypred">Tu pronóstico: <b>{m.myH} : {m.myA}</b></div>
            )}
            {m.status === 'open' && (
              <button className="tg-btn tg-btn-sm tg-btn-primary">GUARDAR</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TableView() {
  return (
    <div className="tg-window tg-c-orange tg-window-wide">
      <div className="tg-titlebar">
        <span className="tg-titlebar-name">Liga de la Oficina · Tabla</span>
        <span className="tg-titlebar-btns"><i>_</i><i>□</i><i>×</i></span>
      </div>
      <div className="tg-window-body">
        {/* Tabla = DATOS, se mantiene LIMPIA y legible */}
        <table className="tg-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="tg-al">Jugador</th>
              <th>PJ</th>
              <th>Aciertos</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {STANDINGS.map(r => (
              <tr key={r.pos} className={r.me ? 'tg-me' : ''}>
                <td>
                  <span className={`tg-medal tg-medal-${r.pos}`}>{r.pos <= 3 ? ['🥇','🥈','🥉'][r.pos - 1] : r.pos}</span>
                </td>
                <td className="tg-al">{r.name}{r.me && <span className="tg-you"> ◄ vos</span>}</td>
                <td>{r.pj}</td>
                <td>{r.ac}</td>
                <td className="tg-pts">{r.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const TG_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

.tg-root {
  --tg-bg: #2b0f4a;
  --tg-bg2: #1a0833;
  --tg-magenta: #ff3db5;
  --tg-cyan: #36d6e7;
  --tg-orange: #ff9f1c;
  --tg-lime: #b6f436;
  --tg-purple: #a855f7;
  --tg-ink: #1a0833;
  --tg-paper: #efe7ff;
  font-family: 'Press Start 2P', monospace;
  color: #fff;
  margin: -1rem -1rem 0;        /* desbordar el padding del layout */
  min-height: 100%;
  padding: 0 0 4rem;
  background:
    linear-gradient(180deg, var(--tg-bg) 0%, var(--tg-bg2) 100%);
  position: relative;
  image-rendering: pixelated;
  -webkit-font-smoothing: none;
}
.tg-root::before {
  content: '';
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
  background-size: 28px 28px;
  pointer-events: none;
}
.tg-root * { box-sizing: border-box; }

.tg-banner {
  font-size: 8px; line-height: 1.6; text-align: center;
  background: var(--tg-lime); color: var(--tg-ink);
  padding: 6px 8px; letter-spacing: .5px;
  border-bottom: 3px solid var(--tg-ink);
}

.tg-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px; position: relative; z-index: 1;
}
.tg-logo { display: flex; align-items: center; gap: 10px; }
.tg-logo-mark {
  background: var(--tg-magenta); color: #fff; padding: 6px 8px;
  border: 3px solid var(--tg-ink);
  box-shadow: 4px 4px 0 var(--tg-ink);
  font-size: 14px;
}
.tg-logo-text {
  font-size: 16px; letter-spacing: 1px;
  text-shadow: 3px 3px 0 var(--tg-magenta), 6px 6px 0 rgba(0,0,0,.4);
}
.tg-header-right { display: flex; align-items: center; gap: 8px; }
.tg-coins {
  font-size: 10px; background: rgba(0,0,0,.35);
  border: 2px solid var(--tg-orange); padding: 6px 8px;
}
.tg-toggle {
  font-family: inherit; font-size: 7px; cursor: pointer; letter-spacing: .5px;
  color: var(--tg-ink); background: var(--tg-lime);
  border: 2px solid var(--tg-ink); box-shadow: 2px 2px 0 var(--tg-ink);
  padding: 7px 8px; transition: transform .05s;
}
.tg-toggle:active { transform: translate(2px,2px); box-shadow: none; }

.tg-tabs {
  display: flex; gap: 6px; padding: 0 16px 12px; flex-wrap: wrap;
  position: relative; z-index: 1;
}
.tg-tab {
  font-family: inherit; font-size: 8px; cursor: pointer;
  color: #fff; background: rgba(255,255,255,.08);
  border: 3px solid var(--tg-ink);
  box-shadow: 3px 3px 0 var(--tg-ink);
  padding: 8px 10px; letter-spacing: .5px;
  transition: transform .05s;
}
.tg-tab:active { transform: translate(3px,3px); box-shadow: none; }
.tg-tab.is-active {
  background: var(--tg-magenta);
  transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--tg-ink);
}

.tg-content { padding: 4px 16px; position: relative; z-index: 1; }
.tg-greet { font-size: 9px; line-height: 1.7; margin: 4px 2px 14px; }
.tg-greet b { color: var(--tg-lime); }

.tg-grid {
  display: grid; gap: 16px;
  grid-template-columns: 1fr;
}
@media (min-width: 720px) { .tg-grid { grid-template-columns: 1fr 1fr; } }

/* Ventanas estilo retro */
.tg-window {
  background: var(--tg-paper); color: var(--tg-ink);
  border: 3px solid var(--tg-ink);
  box-shadow: 6px 6px 0 rgba(0,0,0,.45);
}
.tg-window-wide { max-width: 560px; margin: 0 auto; }
.tg-titlebar {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--tg-purple); color: #fff;
  border-bottom: 3px solid var(--tg-ink);
  padding: 7px 8px; gap: 8px;
}
.tg-c-magenta .tg-titlebar { background: var(--tg-magenta); }
.tg-c-cyan .tg-titlebar { background: var(--tg-cyan); color: var(--tg-ink); }
.tg-c-orange .tg-titlebar { background: var(--tg-orange); color: var(--tg-ink); }
.tg-c-lime .tg-titlebar { background: var(--tg-lime); color: var(--tg-ink); }
.tg-titlebar-name { font-size: 8px; line-height: 1.5; }
.tg-titlebar-btns { display: flex; gap: 4px; }
.tg-titlebar-btns i {
  font-style: normal; font-size: 8px; width: 16px; height: 16px;
  display: grid; place-items: center;
  background: #fff; color: var(--tg-ink); border: 2px solid var(--tg-ink);
}
.tg-window-body { padding: 14px; }

.tg-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.tg-chip {
  font-size: 7px; line-height: 1.6; padding: 5px 6px;
  background: var(--tg-ink); color: #fff; border: 2px solid var(--tg-ink);
}
.tg-chip-ghost { background: #fff; color: var(--tg-ink); }

.tg-stat-row { display: flex; gap: 8px; margin-bottom: 12px; }
.tg-stat {
  flex: 1; text-align: center; background: #fff;
  border: 2px solid var(--tg-ink); padding: 8px 4px;
}
/* Números = DATOS: fuente limpia y legible */
.tg-stat-num {
  display: block; font-family: 'Inter', system-ui, sans-serif;
  font-weight: 900; font-size: 22px; line-height: 1;
}
.tg-stat-lbl { display: block; font-size: 6px; margin-top: 6px; letter-spacing: .5px; }

.tg-next {
  font-size: 7px; line-height: 1.7; background: var(--tg-ink); color: var(--tg-lime);
  padding: 7px 8px; margin-bottom: 12px;
}

/* Botones chunky */
.tg-btn {
  font-family: inherit; font-size: 8px; cursor: pointer; letter-spacing: .5px;
  color: var(--tg-ink); background: #fff;
  border: 3px solid var(--tg-ink); box-shadow: 4px 4px 0 var(--tg-ink);
  padding: 10px 12px; transition: transform .05s;
}
.tg-btn:active { transform: translate(4px,4px); box-shadow: none; }
.tg-btn-block { width: 100%; }
.tg-btn-primary { background: var(--tg-magenta); color: #fff; }
.tg-btn-sm { font-size: 7px; padding: 8px 10px; }

.tg-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
.tg-actions .tg-btn { flex: 1; min-width: 160px; }

/* Partidos */
.tg-match {
  background: #fff; border: 2px solid var(--tg-ink);
  box-shadow: 4px 4px 0 rgba(0,0,0,.2);
  padding: 12px; margin-bottom: 14px;
}
.tg-match-live { box-shadow: 4px 4px 0 var(--tg-magenta); }
.tg-match-done { opacity: .92; }
.tg-match-time {
  font-size: 7px; display: flex; align-items: center; gap: 8px;
  margin-bottom: 10px; color: var(--tg-ink);
}
.tg-live-dot {
  width: 8px; height: 8px; background: var(--tg-magenta);
  display: inline-block; animation: tg-blink 1s steps(2) infinite;
}
@keyframes tg-blink { 50% { opacity: .2; } }
.tg-powerup { background: var(--tg-orange); color: var(--tg-ink); padding: 3px 5px; margin-left: auto; }
.tg-earned { background: var(--tg-lime); color: var(--tg-ink); padding: 3px 5px; margin-left: auto;
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 11px; }

.tg-match-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tg-team { display: flex; align-items: center; gap: 8px; flex: 1; }
.tg-team:last-child { justify-content: flex-end; }
.tg-flag { font-size: 22px; }
.tg-team-name { font-size: 10px; }

/* Marcador = DATOS: fuente limpia */
.tg-score { display: flex; align-items: center; gap: 6px; }
.tg-score-input {
  width: 44px; height: 48px; text-align: center;
  font-family: 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 24px;
  color: var(--tg-ink); background: var(--tg-lime);
  border: 3px solid var(--tg-ink); box-shadow: 3px 3px 0 var(--tg-ink);
  -moz-appearance: textfield;
}
.tg-score-val {
  min-width: 32px; text-align: center;
  font-family: 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 26px;
  color: var(--tg-ink);
}
.tg-score-sep { font-family: 'Inter', sans-serif; font-weight: 900; font-size: 22px; }
.tg-mypred { font-size: 7px; line-height: 1.7; margin-top: 10px; color: #555; }
.tg-mypred b { font-family: 'Inter', sans-serif; font-size: 11px; color: var(--tg-ink); }
.tg-match .tg-btn-sm { margin-top: 10px; }

/* Tabla = DATOS: limpia */
.tg-table {
  width: 100%; border-collapse: collapse;
  font-family: 'Inter', system-ui, sans-serif; color: var(--tg-ink);
}
.tg-table th {
  font-family: 'Press Start 2P', monospace; font-size: 7px; font-weight: 400;
  padding: 8px 6px; border-bottom: 3px solid var(--tg-ink); text-align: center;
}
.tg-table td {
  font-size: 14px; font-weight: 600; padding: 9px 6px; text-align: center;
  border-bottom: 2px solid rgba(0,0,0,.12);
}
.tg-table .tg-al { text-align: left; }
.tg-table .tg-pts { font-weight: 900; font-size: 16px; }
.tg-table tr.tg-me { background: var(--tg-lime); }
.tg-you { font-family: 'Press Start 2P', monospace; font-size: 7px; color: var(--tg-magenta); }
.tg-medal { font-weight: 800; }

@media (max-width: 380px) {
  .tg-logo-text { font-size: 13px; }
  .tg-stat-num { font-size: 18px; }
}

/* ===== MODO CLARO ===== */
.tg-root.tg-light {
  color: var(--tg-ink);
  background: linear-gradient(180deg, #f3ecff 0%, #e7dcff 100%);
}
.tg-root.tg-light::before {
  background-image:
    linear-gradient(rgba(0,0,0,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,0,0,.05) 1px, transparent 1px);
}
.tg-light .tg-logo-text {
  color: var(--tg-ink);
  text-shadow: 3px 3px 0 var(--tg-magenta), 5px 5px 0 rgba(0,0,0,.15);
}
.tg-light .tg-coins {
  background: #fff; color: var(--tg-ink);
}
.tg-light .tg-tab {
  color: var(--tg-ink); background: #fff;
}
.tg-light .tg-tab.is-active { color: #fff; background: var(--tg-magenta); }
.tg-light .tg-greet { color: var(--tg-ink); }
.tg-light .tg-greet b { color: var(--tg-magenta); }
/* Las ventanas, marcadores y tablas ya son claras: se ven igual en ambos modos */
`
