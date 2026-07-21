# Prompt para Claude Design — Rediseño total de "Tico Games"

> Pegá este documento completo en Claude Design como brief. Es el encargo + todo
> el contexto de producto, pantallas, datos y restricciones técnicas.

---

## 🎯 EL ENCARGO

Diseñá, **desde una hoja en blanco**, la identidad visual completa y la interfaz
de **Tico Games**, una app de **quinielas de fútbol multi-torneo** (predicciones).

**Importante — empezá de cero:**
- **NO reutilices nada** del diseño anterior: ni paleta, ni tipografías, ni
  glassmorphism, ni el logo actual, ni los verdes menta / morados / ámbar previos.
- **Creá un logo y una marca nuevos** para "Tico Games" (podés proponer también
  variantes del wordmark). Identidad original.
- Quiero algo **distintivo, con personalidad y premium** — que no se sienta una
  plantilla genérica. Sorprendeme.

**Dirección de producto (no de estilo):** app **mobile-first** instalable (PWA),
se usa sobre todo en el celular; **modo oscuro como principal** (soportar claro
también). Público: grupos de amigos ticos que predicen resultados y compiten. El
tono puede jugar con lo deportivo/competitivo y un guiño costarricense, pero los
**datos y tablas deben quedar muy legibles** (nada de fuentes pixeladas para
números).

---

## ⚽ EL PRODUCTO (qué es y cómo se usa)

Los usuarios se unen a **quinielas** (grupos privados), cada una atada a **un
torneo** (Mundial, LaLiga, Premier, Champions, Primera de Costa Rica…). En cada
quiniela:
- **Predicen el marcador** de cada partido antes de que empiece.
- Ganan **puntos** y compiten en la **tabla de su quiniela**.
- Extras: **comodín x2** (duplica los puntos de un partido, con tope por jornada),
  predicción de **campeón + goleador** del torneo, chat de la liga, logros/insignias.

Un usuario puede estar en **varias quinielas** a la vez (de torneos distintos).

### Reglas de puntaje (para resaltar bien los puntos)
- **Marcador exacto** = **3 pts** · **Resultado correcto** (acierta ganador/empate) = **1 pt** · **Fallo** = 0.
- **Comodín x2**: duplica los puntos de ese partido (exacto→6, correcto→2).
- **Campeón** del torneo = **12 pts** · **Goleador** = **12 pts**.

---

## 🧭 ARQUITECTURA DE NAVEGACIÓN

Modelo **quiniela-céntrico**: lo global es mínimo; todo lo del torneo vive DENTRO
de cada quiniela.

- **Nav global (barra inferior en móvil / lateral en desktop):** solo
  **“Mis quinielas”** y **“Perfil”**. (+ botón flotante de **chat**.)
- **Al entrar a una quiniela**, aparecen sus secciones como pestañas
  (Partidos, Tabla, Posiciones, Campeón/Gol…).

---

## 📱 PANTALLAS A DISEÑAR (con su contenido real)

Cada una en **móvil (prioridad)** y **desktop**, y en **oscuro + claro**.

### 1. Autenticación
Login / registro / “olvidé contraseña” / reset. Hero de marca (primer contacto
con la identidad nueva).

### 2. Inicio = “Mis quinielas” (Hub) — *la cara de la app*
- Saludo al usuario + resumen (“Estás en N quinielas”).
- **Tarjetas de cada quiniela**: nombre, **torneo** (badge), tipo **Copa/Liga**,
  **tu posición** (#3 de 16), **puntos**, **nº de miembros**, próximo partido.
  Cada tarjeta con identidad/acento propio.
- Botones **“Crear quiniela”** y **“Unirme por código”**.
- **Estado vacío** (aún sin quinielas): invitación a crear/unirse.

### 3. Crear quiniela / Unirse por código (modales o pantallas)
- Crear: nombre + **elegir torneo** (de una lista) → genera un **código** para compartir.
- Unirse: input de **código** (6 caracteres).

### 4. Página de una quiniela — *pantalla central*
Header: nombre, badge del **torneo**, **Copa/Liga**, **miembros**, **código** (copiar/compartir), y un “← volver”. Pestañas:
- **Partidos** — *la más usada*. Lista de partidos del torneo **agrupada por su
  fase real** (Jornada 5, Octavos, Cuartos, Semifinal · Ida, Fase de liga,
  Liguilla…). Cada partido = **MatchCard** (ver §5).
- **Tabla** — ranking de la **quiniela** (jugadores por puntos): posición, avatar,
  nombre, puntos, resaltar “vos”.
- **Posiciones** — la **tabla real del fútbol** (equipos): escudo, PJ, G/E/P, DG,
  **Pts**. (En ligas y fase de liga de copas.)
- **Bracket** — solo para el Mundial: cuadro de eliminatoria (árbol de llaves).
- **Campeón / Goleador** — elegir **equipo campeón** (lista de equipos) y
  **goleador** (autocompletar de una lista de jugadores). 12 pts c/u. Puede estar
  **bloqueado** si el torneo ya empezó.

### 5. Detalle de partido (opcional, hay pantalla)
Marcador, tu predicción, predicciones de los demás (cuando ya empezó), goleadores/eventos.

### 6. Perfil
Datos del usuario, avatar, sus estadísticas globales (aciertos exactos, efectividad, comodines, logros/insignias, etc.).

### 7. Overlays globales
- **Chat** de la liga (drawer/botón flotante).
- **Banner de anuncios** (arriba, descartable).
- **Prompt de instalación PWA**, **toasts**.

### 8. Admin (denso y funcional, estética más sobria)
Panel con muchas secciones (torneos, cargar partidos, sincronizar, comodines,
usuarios, anuncios, campeón/goleador por torneo…). No necesita ser bonito, sí claro.

---

## 🧩 COMPONENTES CLAVE Y SUS ESTADOS

### MatchCard (el componente más importante — diseñá todos sus estados)
- **Predecible**: escudos/banderas de ambos equipos + **inputs de marcador**
  (local : visita) + toggle **comodín x2** + botón guardar + cuenta regresiva al cierre.
- **Bloqueado**: falta <15 min o ya empezó (no editable).
- **En vivo**: marcador real actualizándose, badge “EN VIVO” + minuto.
- **Finalizado**: marcador real + tu predicción + **puntos ganados** (+3, +6…).
- **Copa/penales**: definición por penales (quién avanza), etiqueta.
- **Escudos vs banderas**: clubes muestran **escudo** (imagen cuadrada); selecciones muestran **bandera**.

### Otros
- **GroupCard** (tarjeta de quiniela en el Hub) — con acento por color.
- **Fila de tabla** (quiniela: jugadores) y **fila de posiciones** (equipos: escudo + stats).
- **Card de Campeón/Goleador** (selects + autocompletar).
- **Nav** (barra inferior móvil / sidebar desktop), **tournament/quiniela header**.
- **Insignias/logros**: ~13, con emoji + nombre (🔮 Nostradamus, ⚖️ Rey del Empate,
  🎯 Francotirador, 🧊 Pecho Frío, 🤡, 🐢, 💩, 🧨, 🥱, 👻, 🪑, 🐔, 🎰). Rediseñá su tratamiento.
- **Estados**: loading (skeletons), vacío, error — para cada lista.

---

## 🗂️ DATOS REALES (para que los mockups reflejen contenido de verdad)

- **Torneos**: Mundial 2026 (Copa), LaLiga, Premier League, UEFA Champions League,
  Primera División de Costa Rica (Ligas). Cada uno con nombre, tipo, estado.
- **Partidos**: equipos, escudos/banderas, fecha/hora, fase real, marcador,
  estado (pendiente/en vivo/finalizado), goleadores.
- **Quinielas (grupos)**: nombre, código de invitación, torneo, miembros.
- **Predicciones**: marcador predicho, comodín x2, puntos ganados.
- **Jugadores** (para el pick de goleador): nombre, equipo, posición.
- **Usuario**: nombre, avatar, puntos, insignias.

Ejemplos reales para los mockups: equipos como *Alajuelense, Herediano, Saprissa,
Real Madrid, Barcelona, Arsenal, Bayern*; goleadores como *Mbappé, Haaland*;
quinielas como *“La Mejenga del Barrio”, “Liga de la Oficina”*.

---

## 🛠️ RESTRICCIONES TÉCNICAS (para que sea implementable)

- **Stack**: React + **Tailwind CSS v4** + **motion/react** (animaciones) +
  **lucide-react** (íconos). Se implementa con tokens CSS.
- **Tema**: oscuro/claro (diseñá ambos). Oscuro es el principal.
- **Móvil**: app-shell de **altura fija con scroll interno**, barra inferior fija,
  cuidar `safe-area`. Toques grandes, legible al sol.
- **Animaciones**: sutiles y con propósito (entradas, hover, “en vivo”, transiciones
  entre pestañas). Nada que maree.
- Entregar una **paleta con roles claros** (fondo, superficies, texto, acento,
  éxito/error, “en vivo”, oro/podio), **escala tipográfica**, **espaciado**,
  **radios**, **sombras**, y **estados de botón/input**.

---

## 📦 ENTREGABLES IDEALES

1. **Identidad**: logo + marca “Tico Games” (varias opciones), paleta, tipografía.
2. **Sistema de diseño**: tokens (color/espaciado/radio/sombra), componentes base,
   estados de botón/input/tabla/lista/nav.
3. **Pantallas** (móvil + desktop, oscuro + claro), en orden de prioridad:
   1. Hub “Mis quinielas”
   2. Página de quiniela + **MatchCard** en todos sus estados
   3. Tabla (quiniela) y Posiciones (equipos)
   4. Crear/Unirse, Campeón/Goleador, Perfil, Detalle de partido
   5. Auth, Bracket (Mundial), overlays (chat/anuncio/toast)
4. **Micro-interacciones** sugeridas.

**En una frase:** una identidad **nueva, original y memorable** para una app de
quinielas multi-torneo, mobile-first y dark-first, con datos súper legibles y
mucha personalidad — sin nada heredado del diseño anterior.
