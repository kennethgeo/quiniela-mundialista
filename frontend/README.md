# Frontend — Tico Games

React 19 + Vite 6 + Tailwind CSS 4. Es la PWA completa: todo lo que ve el
grupo vive acá. Para el panorama general del proyecto, mirá el
[README raíz](../README.md).

## Comandos

```bash
npm install
cp .env.example .env     # completá los valores de tu proyecto de Supabase
npm run dev              # http://localhost:5173

npm test                 # 309 pruebas de lógica (vitest)
npm run test:ui          # 110 pruebas de interfaz (Playwright)
npm run lint
npm run build
```

## Estructura

```
src/lib/          Lógica pura y probada: puntaje, fechas, filtros, cupos.
src/components/   Interfaz por dominio (matches, tournament, hub, admin, ui…).
src/pages/        Una por ruta.
src/contexts/     Sesión y tema.
src/hooks/        Ganchos compartidos.
tests/ui/         Playwright. Abren la app de verdad, con Supabase interceptado.
```

**La lógica que se pueda probar sin navegador vive en `src/lib/`**, no dentro de
un componente. No es una preferencia de estilo: las reglas de puntaje y de
cupos hay que poder fijarlas en pruebas rápidas, y un `useEffect` no se presta
a eso.

## Cosas que conviene saber antes de tocar

**Las dos suites prueban cosas distintas y ninguna reemplaza a la otra.**
vitest mira lógica pura y no abre la app; Playwright abre la app de verdad. Los
fallos que llegaron a producción —una pantalla que no dejaba guardar, un botón
tapado, una tarjeta que no se dibujaba— ninguno era visible desde vitest.

**Una prueba de interfaz tiene que afirmar sobre lo que se VE.** Comprobar
query params no sirve: la URL los conserva aunque la app los ignore, así que la
prueba pasa con el bug puesto. Está comprobado en este repo.

**En Playwright gana la ÚLTIMA ruta registrada.** El comodín de Supabase va
antes que cualquier ruta específica; al revés se la traga y la pantalla nunca
recibe lo que esperás.

**`/rest/v1/users` y `/rest/v1/matches` se simulan como OBJETO, no como lista.**
El cliente los pide con `.single()`; con una lista el perfil queda en `null` y
media app deja de cargar sin decir por qué.

**El contraste se mide pintando el color en un canvas.** Tailwind 4 devuelve
`oklch(...)` en `getComputedStyle` y leer esos números como RGB da ratios
inventados. Y hay que esperar a que el color se asiente: medir en medio de una
transición ya ocultó un fallo real de accesibilidad.

**El CSP solo permite scripts de este origen.** Nada de librerías por CDN: el
navegador las bloquea sin avisar. Si hace falta un origen externo para fuentes,
imágenes o conexiones, va declarado en `vercel.json` del repo raíz.

El porqué de cada decisión —y los errores que ya se cometieron— está en
[`CLAUDE.md`](../CLAUDE.md).
