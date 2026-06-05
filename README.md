# 🏆 Quiniela Mundialista - FIFA World Cup 2026

Una Progressive Web App (PWA) Full-Stack diseñada para gestionar pronósticos y competencias amistosas durante la Copa Mundial de la FIFA 2026. Construida bajo una arquitectura de monorepo, prioriza el rendimiento, la seguridad y la experiencia en tiempo real.

## ✨ Características Principales

* **Tablas de Posiciones en Vivo:** Sincronización en tiempo real mediante Supabase Realtime (WebSockets) para actualizar el ranking global al instante.
* **Motor de Puntuación Avanzado:** Algoritmo en Python que calcula puntos basados en reglas complejas (marcadores exactos, empates, definiciones por penales y "Power-ups x2").
* **Experiencia PWA Premium:** Diseño "Mobile-first" con Tailwind CSS, soporte offline y capacidad de instalación nativa en dispositivos iOS y Android.
* **Seguridad y Autenticación:** Autenticación de Supabase con verificación obligatoria de correo electrónico y políticas de seguridad a nivel de fila (Row Level Security) en PostgreSQL.

## 🛠️ Stack Tecnológico

* **Frontend:** React + Vite, Tailwind CSS, Framer Motion, Vite-PWA.
* **Backend:** FastAPI (Python), PyJWT.
* **Base de Datos:** PostgreSQL (alojado en Supabase) con reglas estrictas de RLS.
* **Arquitectura:** Monorepo con separación limpia de dominios (`/frontend`, `/backend`, `/database`).

## 🚀 Instalación y Desarrollo Local
*(Próximamente se agregarán las instrucciones de despliegue)*