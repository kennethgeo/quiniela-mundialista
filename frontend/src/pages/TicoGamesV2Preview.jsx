import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/**
 * PREVIEW v2.0 — "Tico Games" (rediseño completo, solo admin)
 * Nuevo sistema de diseño: dark-first, con aire, jerarquía clara y una paleta
 * con personalidad (verde-menta + coral + tinta profunda). Datos de ejemplo.
 * Objetivo: aprobar la dirección visual antes de propagarla a toda la app.
 */

const QUINIELAS = [
  { id: 1, name: 'La Mejenga del Barrio', tournament: 'Mundial 2026', kind: 'cup', members: 16, pos: 3, total: 16, points: 84, trend: +2, next: 'CRC vs BRA', when: 'Hoy 7:00pm', accent: 'mint' },
  { id: 2, name: 'Liga de la Oficina', tournament: 'LaLiga', kind: 'league', members: 9, pos: 1, total: 9, points: 122, trend: 0, next: 'Madrid vs Barça', when: 'Sáb 2:00pm', accent: 'violet' },
  { id: 3, name: 'Champions con los maes', tournament: 'Champions', kind: 'cup', members: 12, pos: 5, total: 12, points: 41, trend: -1, next: 'Octavos', when: 'Mar', accent: 'coral' },
  { id: 4, name: 'Primera Tica', tournament: 'Liga Tica', kind: 'league', members: 7, pos: 2, total: 7, points: 67, trend: +1, next: 'Saprissa vs Liga', when: 'Dom', accent: 'amber' },
]

const UPCOMING = [
  { id: 1, home: 'CRC', away: 'BRA', hf: '🇨🇷', af: '🇧🇷', when: 'Hoy 7:00pm', tour: 'Mundial', locked: false },
  { id: 2, home: 'ESP', away: 'GER', hf: '🇪🇸', af: '🇩🇪', when: 'En vivo 67’', tour: 'Champions', live: true, lh: 2, la: 1 },
  { id: 3, home: 'MAD', away: 'BAR', hf: '⚪', af: '🔵', when: 'Sáb 2:00pm', tour: 'LaLiga', locked: false },
]

const STANDINGS = [
  { pos: 1, name: 'Karla', pts: 122, hit: 64, me: false },
  { pos: 2, name: 'Kenneth', pts: 118, hit: 61, me: true },
  { pos: 3, name: 'Diego', pts: 110, hit: 58, me: false },
  { pos: 4, name: 'Mau', pts: 97, hit: 52, me: false },
]

export default function TicoGamesV2Preview() {
  const { profile } = useAuth()
  const [mode, setMode] = useState('dark')
  if (profile && !profile.is_admin) return <Navigate to="/" replace />

  return (
    <div className={`tgx tgx-${mode}`}>
      <style>{CSS}</style>

      <div className="tgx-note">
        Preview v2.0 · solo admin · datos de ejemplo
        <button className="tgx-mode" onClick={() => setMode(m => (m === 'dark' ? 'light' : 'dark'))}>
          {mode === 'dark' ? '☀︎ Claro' : '☾ Oscuro'}
        </button>
      </div>

      {/* Top bar */}
      <header className="tgx-top">
        <div className="tgx-brand">
          <span className="tgx-mark">TG</span>
          <span className="tgx-word">Tico<b>Games</b></span>
        </div>
        <div className="tgx-top-right">
          <div className="tgx-pts"><span className="tgx-pts-num">432</span><span className="tgx-pts-lbl">pts</span></div>
          <div className="tgx-avatar">K</div>
        </div>
      </header>

      <main className="tgx-main">
        {/* Saludo */}
        <section className="tgx-hero">
          <p className="tgx-hi">Buenas, Kenneth 👋</p>
          <h1 className="tgx-h1">Tus quinielas</h1>
          <p className="tgx-sub">Estás compitiendo en <b>4 quinielas</b> · 2 con jugada pendiente</p>
        </section>

        {/* Grid de quinielas */}
        <section className="tgx-grid">
          {QUINIELAS.map(q => (
            <article key={q.id} className={`tgx-card tgx-a-${q.accent}`}>
              <div className="tgx-card-top">
                <div className="tgx-tags">
                  <span className="tgx-tag tgx-tag-strong">{q.tournament}</span>
                  <span className="tgx-tag">{q.kind === 'cup' ? '🏆 Copa' : '📊 Liga'}</span>
                </div>
                <span className="tgx-members">{q.members} maes</span>
              </div>

              <h3 className="tgx-card-name">{q.name}</h3>

              <div className="tgx-card-stats">
                <div className="tgx-rank">
                  <span className="tgx-rank-num">#{q.pos}</span>
                  <span className="tgx-rank-of">de {q.total}</span>
                  {q.trend !== 0 && (
                    <span className={`tgx-trend ${q.trend > 0 ? 'up' : 'down'}`}>
                      {q.trend > 0 ? '▲' : '▼'}{Math.abs(q.trend)}
                    </span>
                  )}
                </div>
                <div className="tgx-pts-box">
                  <span className="tgx-pts-box-num">{q.points}</span>
                  <span className="tgx-pts-box-lbl">puntos</span>
                </div>
              </div>

              <div className="tgx-next">
                <span className="tgx-next-dot" />
                <span className="tgx-next-txt"><b>{q.next}</b> · {q.when}</span>
                <span className="tgx-next-go">→</span>
              </div>
            </article>
          ))}
        </section>

        {/* CTAs */}
        <section className="tgx-cta">
          <button className="tgx-btn tgx-btn-primary">＋ Crear quiniela</button>
          <button className="tgx-btn tgx-btn-ghost">🔑 Unirme por código</button>
        </section>

        {/* Próximos partidos */}
        <section className="tgx-block">
          <div className="tgx-block-head">
            <h2 className="tgx-h2">Próximos partidos</h2>
            <span className="tgx-see">Ver todos</span>
          </div>
          <div className="tgx-matches">
            {UPCOMING.map(m => (
              <div key={m.id} className={`tgx-match ${m.live ? 'is-live' : ''}`}>
                <div className="tgx-match-meta">
                  <span className="tgx-match-tour">{m.tour}</span>
                  <span className={`tgx-match-when ${m.live ? 'live' : ''}`}>
                    {m.live && <span className="tgx-livedot" />}{m.when}
                  </span>
                </div>
                <div className="tgx-match-body">
                  <div className="tgx-side"><span className="tgx-flag">{m.hf}</span><span className="tgx-code">{m.home}</span></div>
                  {m.live
                    ? <div className="tgx-scoreline">{m.lh}<span>:</span>{m.la}</div>
                    : <div className="tgx-vs">VS</div>}
                  <div className="tgx-side tgx-side-r"><span className="tgx-code">{m.away}</span><span className="tgx-flag">{m.af}</span></div>
                </div>
                {!m.live && <button className="tgx-predict">Predecir marcador</button>}
              </div>
            ))}
          </div>
        </section>

        {/* Mini tabla */}
        <section className="tgx-block">
          <div className="tgx-block-head">
            <h2 className="tgx-h2">Liga de la Oficina · Tabla</h2>
            <span className="tgx-see">Completa</span>
          </div>
          <div className="tgx-table">
            {STANDINGS.map(r => (
              <div key={r.pos} className={`tgx-row ${r.me ? 'is-me' : ''}`}>
                <span className={`tgx-pos tgx-pos-${r.pos}`}>{r.pos}</span>
                <span className="tgx-name">{r.name}{r.me && <em> · vos</em>}</span>
                <span className="tgx-hit">{r.hit}% acierto</span>
                <span className="tgx-rowpts">{r.pts}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="tgx-foot">Tico Games · rediseño 2.0</div>
      </main>
    </div>
  )
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');

.tgx {
  --font-d: 'Sora', system-ui, sans-serif;
  --font-b: 'Inter', system-ui, sans-serif;
  --mint: #37e6a4;
  --mint-2: #16b98a;
  --violet: #8b7bff;
  --coral: #ff6b7d;
  --amber: #ffbf47;
  --gold: #ffce54;
  margin: -1rem -1rem 0;
  min-height: calc(100% + 1rem);
  font-family: var(--font-b);
  position: relative;
}
.tgx * { box-sizing: border-box; }

/* ===== DARK (protagonista) ===== */
.tgx-dark {
  --bg: #090b10;
  --bg-2: #0e1118;
  --card: #141824;
  --card-2: #1b2130;
  --line: rgba(255,255,255,.07);
  --line-2: rgba(255,255,255,.12);
  --tx: #eef2f8;
  --tx-mut: #8c96a8;
  --tx-dim: #5b6577;
  color: var(--tx);
  background:
    radial-gradient(1100px 500px at 100% -10%, rgba(55,230,164,.10), transparent 60%),
    radial-gradient(900px 500px at -10% 10%, rgba(139,123,255,.10), transparent 55%),
    var(--bg);
}
/* ===== LIGHT ===== */
.tgx-light {
  --bg: #f4f6fb;
  --bg-2: #ffffff;
  --card: #ffffff;
  --card-2: #f6f8fc;
  --line: rgba(10,14,25,.08);
  --line-2: rgba(10,14,25,.14);
  --tx: #101627;
  --tx-mut: #5a6478;
  --tx-dim: #97a0b2;
  color: var(--tx);
  background:
    radial-gradient(1000px 480px at 100% -10%, rgba(22,185,138,.12), transparent 60%),
    radial-gradient(900px 480px at -10% 8%, rgba(139,123,255,.12), transparent 55%),
    var(--bg);
}

.tgx-note {
  font-size: 11px; color: var(--tx-mut); text-align: center;
  padding: 9px 14px; display: flex; align-items: center; justify-content: center; gap: 12px;
  border-bottom: 1px solid var(--line); background: var(--bg-2);
}
.tgx-mode {
  font-family: var(--font-b); font-size: 11px; font-weight: 600; cursor: pointer;
  color: var(--tx); background: var(--card-2); border: 1px solid var(--line-2);
  border-radius: 999px; padding: 4px 11px;
}

/* Top bar */
.tgx-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; position: sticky; top: 0; z-index: 5;
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  backdrop-filter: blur(14px); border-bottom: 1px solid var(--line);
}
.tgx-brand { display: flex; align-items: center; gap: 11px; }
.tgx-mark {
  width: 38px; height: 38px; display: grid; place-items: center;
  font-family: var(--font-d); font-weight: 800; font-size: 15px; letter-spacing: -.5px;
  color: #06231a; border-radius: 12px;
  background: linear-gradient(135deg, var(--mint), var(--mint-2));
  box-shadow: 0 6px 20px rgba(55,230,164,.35);
}
.tgx-word { font-family: var(--font-d); font-weight: 700; font-size: 19px; letter-spacing: -.5px; }
.tgx-word b { font-weight: 800; background: linear-gradient(120deg, var(--mint), var(--violet)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.tgx-top-right { display: flex; align-items: center; gap: 12px; }
.tgx-pts { display: flex; align-items: baseline; gap: 5px; background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 7px 13px; }
.tgx-pts-num { font-family: var(--font-d); font-weight: 800; font-size: 15px; }
.tgx-pts-lbl { font-size: 10px; color: var(--tx-mut); text-transform: uppercase; letter-spacing: .5px; }
.tgx-avatar {
  width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
  font-family: var(--font-d); font-weight: 700; color: #fff;
  background: linear-gradient(135deg, var(--violet), var(--coral));
}

.tgx-main { padding: 22px 18px 60px; max-width: 760px; margin: 0 auto; }

/* Hero */
.tgx-hero { margin-bottom: 22px; }
.tgx-hi { font-size: 13px; color: var(--tx-mut); font-weight: 500; }
.tgx-h1 { font-family: var(--font-d); font-weight: 800; font-size: 30px; letter-spacing: -1px; margin: 3px 0 6px; line-height: 1.05; }
.tgx-sub { font-size: 13.5px; color: var(--tx-mut); }
.tgx-sub b { color: var(--tx); font-weight: 700; }

/* Grid de quinielas */
.tgx-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
@media (min-width: 680px) { .tgx-grid { grid-template-columns: 1fr 1fr; } }

.tgx-card {
  --a: var(--mint);
  position: relative; overflow: hidden;
  background: var(--card); border: 1px solid var(--line);
  border-radius: 22px; padding: 18px;
  transition: transform .16s ease, border-color .16s ease;
}
.tgx-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--a);
}
.tgx-card:hover { transform: translateY(-3px); border-color: var(--line-2); }
.tgx-a-mint { --a: var(--mint); }
.tgx-a-violet { --a: var(--violet); }
.tgx-a-coral { --a: var(--coral); }
.tgx-a-amber { --a: var(--amber); }

.tgx-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.tgx-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tgx-tag {
  font-size: 10.5px; font-weight: 600; padding: 4px 9px; border-radius: 999px;
  color: var(--tx-mut); background: var(--card-2); border: 1px solid var(--line);
}
.tgx-tag-strong { color: var(--a); background: color-mix(in srgb, var(--a) 14%, transparent); border-color: color-mix(in srgb, var(--a) 30%, transparent); }
.tgx-members { font-size: 11px; color: var(--tx-dim); }

.tgx-card-name { font-family: var(--font-d); font-weight: 700; font-size: 17px; letter-spacing: -.3px; margin-bottom: 14px; line-height: 1.2; }

.tgx-card-stats { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 15px; }
.tgx-rank { display: flex; align-items: baseline; gap: 6px; }
.tgx-rank-num { font-family: var(--font-d); font-weight: 800; font-size: 30px; letter-spacing: -1px; color: var(--a); line-height: 1; }
.tgx-rank-of { font-size: 12px; color: var(--tx-mut); }
.tgx-trend { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 6px; }
.tgx-trend.up { color: var(--mint); background: color-mix(in srgb, var(--mint) 15%, transparent); }
.tgx-trend.down { color: var(--coral); background: color-mix(in srgb, var(--coral) 15%, transparent); }
.tgx-pts-box { text-align: right; }
.tgx-pts-box-num { display: block; font-family: var(--font-d); font-weight: 800; font-size: 22px; line-height: 1; }
.tgx-pts-box-lbl { font-size: 10px; color: var(--tx-mut); text-transform: uppercase; letter-spacing: .5px; }

.tgx-next {
  display: flex; align-items: center; gap: 9px;
  background: var(--card-2); border: 1px solid var(--line);
  border-radius: 13px; padding: 10px 12px;
}
.tgx-next-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--a); box-shadow: 0 0 0 3px color-mix(in srgb, var(--a) 22%, transparent); }
.tgx-next-txt { flex: 1; font-size: 12px; color: var(--tx-mut); }
.tgx-next-txt b { color: var(--tx); font-weight: 700; }
.tgx-next-go { color: var(--a); font-weight: 700; }

/* CTA */
.tgx-cta { display: flex; gap: 11px; margin: 20px 0 8px; flex-wrap: wrap; }
.tgx-btn {
  flex: 1; min-width: 150px; font-family: var(--font-d); font-weight: 700; font-size: 14px;
  cursor: pointer; border-radius: 14px; padding: 14px 16px; border: 1px solid transparent;
  transition: transform .1s ease, filter .16s ease;
}
.tgx-btn:active { transform: scale(.98); }
.tgx-btn-primary { color: #06231a; background: linear-gradient(135deg, var(--mint), var(--mint-2)); box-shadow: 0 8px 24px rgba(55,230,164,.28); }
.tgx-btn-primary:hover { filter: brightness(1.05); }
.tgx-btn-ghost { color: var(--tx); background: var(--card); border-color: var(--line-2); }

/* Bloques */
.tgx-block { margin-top: 28px; }
.tgx-block-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 13px; }
.tgx-h2 { font-family: var(--font-d); font-weight: 700; font-size: 17px; letter-spacing: -.3px; }
.tgx-see { font-size: 12px; font-weight: 600; color: var(--mint); cursor: pointer; }

/* Partidos */
.tgx-matches { display: grid; gap: 11px; }
.tgx-match { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 14px 16px; }
.tgx-match.is-live { border-color: color-mix(in srgb, var(--coral) 40%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--coral) 20%, transparent); }
.tgx-match-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.tgx-match-tour { font-size: 10.5px; font-weight: 600; color: var(--tx-dim); text-transform: uppercase; letter-spacing: .6px; }
.tgx-match-when { font-size: 11.5px; color: var(--tx-mut); display: flex; align-items: center; gap: 6px; }
.tgx-match-when.live { color: var(--coral); font-weight: 700; }
.tgx-livedot { width: 7px; height: 7px; border-radius: 999px; background: var(--coral); animation: tgx-blink 1.1s ease-in-out infinite; }
@keyframes tgx-blink { 50% { opacity: .25; } }
.tgx-match-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tgx-side { display: flex; align-items: center; gap: 9px; flex: 1; }
.tgx-side-r { justify-content: flex-end; }
.tgx-flag { font-size: 22px; }
.tgx-code { font-family: var(--font-d); font-weight: 700; font-size: 15px; }
.tgx-vs { font-size: 11px; font-weight: 700; color: var(--tx-dim); letter-spacing: 1px; }
.tgx-scoreline { font-family: var(--font-d); font-weight: 800; font-size: 22px; display: flex; align-items: center; gap: 7px; }
.tgx-scoreline span { color: var(--tx-dim); }
.tgx-predict {
  width: 100%; margin-top: 12px; font-family: var(--font-b); font-weight: 700; font-size: 13px;
  cursor: pointer; color: var(--mint); background: color-mix(in srgb, var(--mint) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--mint) 28%, transparent); border-radius: 11px; padding: 10px;
}

/* Tabla */
.tgx-table { background: var(--card); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
.tgx-row { display: flex; align-items: center; gap: 12px; padding: 13px 15px; border-bottom: 1px solid var(--line); }
.tgx-row:last-child { border-bottom: 0; }
.tgx-row.is-me { background: color-mix(in srgb, var(--mint) 9%, transparent); }
.tgx-pos { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-family: var(--font-d); font-weight: 700; font-size: 13px; color: var(--tx-mut); background: var(--card-2); }
.tgx-pos-1 { color: #4a3200; background: var(--gold); }
.tgx-pos-2 { color: #2a2f38; background: #cdd6e3; }
.tgx-pos-3 { color: #3a2415; background: #e5a666; }
.tgx-name { flex: 1; font-weight: 600; font-size: 14px; }
.tgx-name em { color: var(--mint); font-style: normal; font-weight: 700; font-size: 12px; }
.tgx-hit { font-size: 11.5px; color: var(--tx-mut); }
.tgx-rowpts { font-family: var(--font-d); font-weight: 800; font-size: 16px; min-width: 42px; text-align: right; }

.tgx-foot { text-align: center; font-size: 11px; color: var(--tx-dim); margin-top: 34px; }
`
