# Tico Games

*[Read in English](README.en.md)*

Aplicación web (PWA) para quinielas de fútbol entre amigos: cada grupo predice
los marcadores de un torneo, la app puntúa sola con los resultados reales y
lleva la tabla, el histórico y el pozo.

Nació para el Mundial 2026 y hoy corre **varios torneos a la vez** — Copa del
Mundo, UEFA Champions League y la primera división de Costa Rica— cada uno con
sus propias quinielas, reglas y puntajes.

La usa un grupo real de 26 personas, y se juega por plata. Eso condiciona casi
todas las decisiones de diseño: nadie puede ver las predicciones ajenas antes
del saque, las reglas no se cambian con el torneo en marcha sin votación del
grupo, y un puntaje mal calculado no es un detalle cosmético.

## Qué hace

- **Predicciones con cierre automático** 15 minutos antes de cada saque. Hasta
  ese momento, nadie ve lo que predijeron los demás.
- **Puntaje automático**: marcador exacto, resultado correcto, reglas propias
  para las tandas de penales, y un comodín «×2» con cupo por ronda.
- **Marcadores en vivo** sincronizados desde ESPN, con la tabla y el histórico
  recalculándose solos.
- **Detalle del partido**: alineaciones dibujadas sobre una cancha, forma
  reciente de los dos equipos y enfrentamientos previos.
- **Avisos**: resumen de los partidos del día a las 6 a.m. y recordatorio 45
  minutos antes del saque, solo a quien tiene predicciones pendientes.
- **Varias quinielas por torneo**, cada una con su admin, sus reglas de puntaje,
  su pozo y sus votaciones para cambiar las reglas.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19 · Vite 6 · Tailwind CSS 4 · `motion` · TanStack Query · vite-plugin-pwa |
| Backend | FastAPI (Python 3.12) · PyJWT · httpx · pywebpush |
| Base de datos | PostgreSQL en Supabase, con Row Level Security y `pg_cron` |
| Autenticación | Supabase Auth: correo y contraseña, o «Entrar con Google» |
| Despliegue | Vercel (frontend y backend juntos) |

## Estructura

```
frontend/    React + Vite. La PWA y toda la interfaz.
backend/     FastAPI. Sincronización con ESPN, notificaciones push, tareas de admin.
database/    Migraciones SQL numeradas (87 a la fecha). Se aplican a mano.
docs/        Documentación de funcionalidades concretas.
shared/      Constantes compartidas.
scripts/     Utilidades sueltas de mantenimiento.
```

## Correrlo en local

Hace falta **Node 20** y **Python 3.12**, y un proyecto de Supabase propio con
las migraciones de `database/` aplicadas en orden.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env          # y completá los valores de tu proyecto
npm run dev                   # http://localhost:5173
```

`.env` necesita:

```
VITE_SUPABASE_URL=https://<tu-proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<tu anon key>
VITE_API_URL=/_backend
```

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # y completá los valores
uvicorn app.main:app --reload # http://localhost:8000
```

`requirements.txt` es solo lo que viaja al serverless;
`requirements-dev.txt` lo incluye y añade el servidor local y pytest.

## Pruebas

```bash
cd frontend
npm test          # 309 pruebas de lógica (vitest)
npm run test:ui   # 110 pruebas de interfaz (Playwright, sin backend real)
npm run lint

cd ../backend
python -m pytest  # 107 pruebas
```

Las de Playwright **interceptan Supabase**: no tocan ninguna base de datos real
y no necesitan credenciales.

## Despliegue

Cada push a `main` despliega frontend y backend juntos en Vercel
(`vercel.json` → `experimentalServices`; el backend queda bajo `/_backend`).

Las tareas periódicas —sincronizar marcadores, el resumen de las 6 a.m. y el
recordatorio del saque— las dispara **`pg_cron` desde la propia base de datos**,
no GitHub Actions. Se midió que `schedule:` de GitHub cumplía apenas el 2.5% de
las corridas esperadas.

Las migraciones de `database/` **se aplican a mano** en el editor SQL de
Supabase, en orden. `database/verificar_estado.sql` es de solo lectura y compara
la base viva contra el repo.

## Documentación

- **[`CLAUDE.md`](CLAUDE.md)** — el documento importante: un registro de
  decisiones de arquitectura con la medición que motivó cada una, el modo de
  fallo que evita y los errores que ya se cometieron. Si vas a tocar el puntaje,
  la seguridad de la base o los cupos del comodín, empezá por ahí.
- [`docs/CALENDARIO.md`](docs/CALENDARIO.md) — exportación de partidos al calendario.
- [`APLICAR_MIGRACIONES.md`](APLICAR_MIGRACIONES.md) — cómo aplicar las migraciones.

## Estado

En producción y en uso. No es un proyecto de demostración: los datos son reales
y hay dinero de por medio, así que los cambios se miden antes de publicarse.
