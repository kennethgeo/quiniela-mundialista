# Tico Games — Brief de Rediseño (v2.0)

Documento para diseñar la app desde cero (Claude Design). Incluye producto,
marca, pantallas con su contenido real, data disponible y restricciones técnicas.

---

## 1. Qué es la app

**Tico Games** es una app de **quinielas de fútbol multi-torneo** (predicciones).
Costarricense, tono divertido pero premium. Los usuarios:

- Se unen a **grupos** ("quinielas"), cada grupo atado a **un torneo** (Mundial,
  LaLiga, Champions, ligas locales…).
- **Predicen el marcador** de cada partido antes de que empiece.
- Ganan **puntos** y compiten en la **tabla de su grupo**.
- Tienen extras: **comodín x2**, predicción global de **campeón + goleador**,
  **logros/badges**, chat de la liga.

Es **PWA instalable**, se usa sobre todo en **celular**.

### Reglas de puntaje (para que el diseño resalte los puntos bien)
- **Marcador exacto** = **3 pts** · **Resultado correcto** (acierta ganador/empate, no el marcador) = **1 pt** · **Fallo** = 0.
- **Comodín x2**: duplica los puntos de ese partido (exacto → 6, correcto → 2). Límite por fase/jornada.
- **Eliminatoria con penales**: el empate puntúa igual; +1 si acierta quién avanza; el x2 duplica todo.
- **Global**: acertar **campeón** = 12 pts · acertar **goleador** = 12 pts (por torneo).

---

## 2. Marca

- **Nombre:** Tico Games. Tagline: *"Predice · Compite · Presume"*.
- **Logo:** marca actual en `frontend/public/tico-mark.svg` (triángulo "play" en
  cuadrado redondeado con gradiente menta). Se puede rediseñar.
- **Tono:** enérgico, deportivo, con personalidad tica, pero **legible y limpio**
  (NO arcade pixelado — se probó y cansa para datos/tablas).

### Paleta actual (punto de partida, se puede evolucionar)
| Rol | Valor |
|---|---|
| Fondo dark (tinta) | `#090b10` |
| Superficie/tarjeta dark | `#14161d` (borde `rgba(255,255,255,.07)`) |
| Acento principal (menta) | `#2fdd9a` → `#12b98a` |
| Secundario (violeta) | `#8b7bff` |
| En vivo / alerta (coral) | `#ff6b7d` |
| Oro / #1 | `#ffce54` |
| Texto | `#eaf0f7` / muted `#8c96a8` |

- **Tipografía:** display **Sora** (700/800) para títulos y números grandes;
  cuerpo **Inter**. Números/datos siempre en fuente limpia (legibilidad).

### Qué NO gustó del diseño anterior (evitar)
- Se sentía **genérico** y **apretado** ("todo pegado").
- Paleta morado/ámbar poco cuidada.
- Fondo **cuadriculado** (grilla) genérico.
- Glass turbio.

### Qué se busca
- **Aire** (padding y separación generosos), jerarquía clara, tarjetas limpias.
- Distintivo y premium. **Dark-first** (es el modo principal), pero soportar light.
- **Animaciones sutiles** (entradas, hover, en vivo) — con `motion/react`.

---

## 3. Pantallas a diseñar (con su contenido real)

Mobile-first; también layout desktop (sidebar). Cada pantalla en **dark y light**.

1. **Auth** (`/auth`) — login / registro / olvidé contraseña / reset. Hero de marca.
2. **Hub / Inicio** (`/`) — **la más importante**. "Tus quinielas": tarjetas de
   cada grupo (nombre, torneo, Copa/Liga, tu **posición**, puntos, nº miembros,
   próximo partido). Botones **Crear quiniela** y **Unirme por código**. Estado
   vacío (aún sin grupos).
3. **Grupo / Tabla** — al abrir un grupo: tabla de posiciones (rank, avatar,
   nombre, puntos, "vos"), código para compartir, torneo, miembros.
4. **Partidos / Predicción** — **la más usada**. Lista de partidos de un torneo
   agrupada por jornada/fase. Cada partido = **MatchCard** (ver §4). Tabs o
   filtros: Hoy / Próximos / En vivo / Finalizados. Para Copas además: bracket.
5. **Detalle de partido** (`/match/:id`) — marcador, tu predicción, predicciones
   de los demás (cuando ya empezó), goleadores/eventos, comodín.
6. **Bracket** (`/bracket`) — cuadro de eliminatoria (solo Copas). Árbol de llaves.
7. **Ranking** (`/leaderboard`) — tabla global + por grupo. Podio top-3 + lista.
   Badges/logros por jugador (emojis). Tocar jugador → modal de stats.
8. **Global** (`/torneo`) — predicción de **campeón** (equipo) y **goleador**
   (jugador) por torneo, y tablero con las predicciones de todos.
9. **Perfil** (`/profile`) — datos del usuario, avatar, sus stats.
10. **Reglas** (`/rules`) — tarjetas explicando el puntaje.
11. **Admin** (`/admin`) — panel con muchas sub-secciones (torneos, partidos/
    resultados, comodines, usuarios, anuncios, etc.). Denso, funcional.
12. **Overlays globales**: **chat** de la liga (drawer flotante), **banner de
    anuncios** (arriba), **install prompt** (PWA), **toasts**.

### Navegación
- **Móvil:** barra inferior (BottomNav) con ~6 íconos. App-shell de altura fija
  con scroll interno (importante para el layout).
- **Escritorio:** sidebar lateral con logo + navegación + perfil + toggle tema.

---

## 4. Componentes clave y sus estados

- **MatchCard** (el más importante) — estados:
  - *Predecible*: inputs de marcador (local : visita) + toggle **comodín x2** + guardar.
  - *Bloqueado*: faltan <15 min o ya empezó (no editable).
  - *En vivo*: marcador real actualizándose, badge "EN VIVO".
  - *Finalizado*: marcador real + tu predicción + **puntos ganados** (+3, +6…).
  - Extra Copa: definición por **penales** (quién avanza), etiqueta "pen".
- **GroupCard** (Hub) — torneo, tipo, posición grande, puntos, miembros, próximo partido, acento de color propio.
- **LeaderboardRow / Podium** — rank, avatar, nombre, puntos, delta en vivo, badges.
- **PlayerStatsModal** — exactos, acierto ganador, fallos, efectividad, comodines, goles del goleador, campeón, logros. (Panel arrastrable en móvil.)
- **Tournament switcher** — para cambiar de torneo/grupo (nuevo en v2).
- **Nav** (sidebar + bottom).
- **Sheets/Modales** (crear grupo, unirse por código, stats, etc.).
- **Badges/logros**: ~13 emojis con tooltip (🔮 Nostradamus, ⚖️ Rey del Empate, 🎯 Francotirador, 🧊 Pecho Frío, 🤡, 🐢, 💩, 🧨, 🥱, 👻, 🪑, 🐔, 🎰).

---

## 5. Data disponible (para que el diseño calce con lo real)

**Tablas** (Supabase/Postgres):
- `tournaments` (id, name, kind 'cup'|'league', status, source, season, logo_url…). El Mundial 2026 = torneo #1.
- `matches` (tournament_id, home_team, away_team, *_team_code [ISO flagcdn], kickoff_at, phase, matchday, group_name, home/away_goals_actual, status 'pending'|'in_progress'|'finished', goes_to_penalties, penalties_winner_real, events_json [goleadores]).
- `predictions` (user_id, match_id, home/away_goals_pred, use_powerup_x2, points_earned).
- `leagues` (= grupos: id, name, invitation_code, admin_id, tournament_id, description).
- `league_members` (league_id, user_id).
- `tournament_predictions` (user_id, tournament_id, champion_team, top_scorer_name, champion_points, top_scorer_points).
- `users` (display_name, avatar_url, total_points, is_admin, points_adjustment).
- `user_badges_view` (totales + exact/correct counts + scorer_goals + champion_hit + flags de badges).
- `powerup_limits` (phase, matchday, max_uses).
- `global_settings` (announcement, prizes, textos…). `global_chat` (chat).

**RPCs de grupos** (ya listas): `my_groups()`, `group_standings(league_id)`,
`create_group(name, tournament_id)`, `join_group_by_code(code)`.
Vista `user_tournament_points(user_id, tournament_id, points)`.

**Lo único que falta a nivel código para cerrar multi-torneo**: la **UI de
predicción genérica por torneo** (fetch `matches` por `tournament_id`, agrupar por
`matchday`, render MatchCard). Es puro front → ideal hacerla ya con el diseño nuevo.

---

## 6. Restricciones técnicas (para que el diseño sea implementable)

- **Stack:** React 19 + Vite, **Tailwind v4** (tokens en `@theme` dentro de
  `frontend/src/index.css`), animaciones con **motion/react**, íconos **lucide-react**.
- **Tema:** dark/light por clase `.dark` en `<html>` + variables CSS. Diseñar ambos.
- **Tokens del sistema** viven en `frontend/src/index.css`:
  `--color-accent*`, `--glass-card-*` (superficies), `--bg-world-cup*` (fondo),
  y `--font-display` (Sora). Cambiando ahí se propaga a toda la app.
- **Marca** centralizada en `frontend/src/lib/brand.js` (`APP_NAME`).
- **Móvil:** app-shell de **altura fija con scroll interno** (no scroll de
  documento); la BottomNav es fija abajo. Cuidar `safe-area-inset`.
- **Self-contained**: fuentes por Google Fonts (`@import` en index.css).

### Referencias vivas del estilo nuevo (ya en el repo)
- `frontend/src/pages/TicoGamesV2Preview.jsx` → ruta **`/v2`** (solo admin): preview del Hub en el estilo nuevo.
- `frontend/src/pages/HubPage.jsx` → **`/`** (Hub real, datos reales).
- `frontend/src/index.css` → tokens y utilidades (`glass-card`, `bg-world-cup`).

---

## 7. Prioridad sugerida de pantallas

1. **Hub / Inicio** (cara de la app).
2. **Partidos / MatchCard** (lo más usado; define el lenguaje de datos).
3. **Grupo / Tabla** y **Ranking**.
4. **Detalle de partido**, **Global (campeón/goleador)**, **Perfil**.
5. **Bracket**, **Reglas**, **Auth**.
6. **Admin** (funcional, puede ser más sobrio).

---

## 8. Entregables ideales del diseño

- Cada pantalla en **móvil** (prioridad) y **desktop**, **dark + light**.
- Specs de **MatchCard** en todos sus estados.
- Sistema: paleta final, tipografía, escalas de espaciado/radio, sombras,
  estados de botón/input, componentes de tabla/lista, nav.
- Micro-interacciones/animaciones sugeridas (entradas, hover, "en vivo").
- Logo/marca final si se cambia.
