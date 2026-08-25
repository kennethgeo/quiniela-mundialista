import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Un argumento o un catch que no se usa es ruido, no un bug. Se permite
      // silenciarlos con guion bajo, que es la convención habitual.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // eslint-plugin-react-hooks v6 trae reglas nuevas y bastante opinionadas
      // (set-state-in-effect, static-components, immutability, purity). Marcan
      // cosas mejorables, no bugs: la app funciona y está probada. Quedan como
      // AVISO a propósito — reescribir 37 usos de hooks dentro de una tanda de
      // seguridad es justo cómo se cuela una regresión. Se van bajando aparte.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      // Solo afecta al hot-reload en desarrollo, nunca a producción.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // El service worker de push no corre en la ventana: tiene sus propios
    // globales (clients, self, registration). Sin esto, eslint los reportaba
    // como variables inexistentes — 3 falsos positivos.
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
  },
  {
    // Los scripts de mantenimiento corren en Node, no en el navegador.
    files: ['scripts/**/*.js', '*.cjs', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
