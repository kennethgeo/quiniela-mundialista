import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

// Regla de arquitectura: solo matchStatus normaliza sufijos de zona.
// Se analiza el AST para no confundir comentarios (como la explicación del bug
// en MatchCard) con código ejecutable. ESLint ya es dependencia del proyecto.
const regla = {
  meta: { schema: [], messages: { copia: 'Usar kickoffDate de lib/matchStatus; no normalizar zonas en otra copia.' } },
  create(context) {
    const reportar = node => context.report({ node, messageId: 'copia' })
    return {
      CallExpression(node) {
        const fn = node.callee
        const metodo = fn?.computed ? fn.property?.value : fn?.property?.name
        if (metodo === 'endsWith' && /^z$/i.test(node.arguments[0]?.value ?? '')) reportar(node)
      },
      TemplateLiteral(node) {
        if (node.expressions.length && /^z$/i.test(node.quasis.at(-1).value.cooked)) reportar(node)
      },
      BinaryExpression(node) {
        if (node.operator === '+' && /^z$/i.test(node.right?.value ?? '')) reportar(node)
      },
    }
  },
}
const linter = new Linter()
const verificar = codigo => linter.verify(codigo, [{
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { fechas: { rules: { compartida: regla } } },
  rules: { 'fechas/compartida': 'error' },
}], { allowInlineConfig: false })

function archivos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const ruta = join(dir, e.name)
    return e.isDirectory() ? archivos(ruta) : /\.[jt]sx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [ruta] : []
  })
}

describe('una sola normalización de la fecha de saque', () => {
  it('no hay copias ejecutables en ningún consumidor, incluidas rutas antiguas', () => {
    const src = fileURLToPath(new URL('..', import.meta.url))
    const problemas = archivos(src).filter(p => p !== join(src, 'lib', 'matchStatus.js')).flatMap(p =>
      verificar(readFileSync(p, 'utf8')).map(m => `${relative(src, p)}:${m.line} ${m.message}`))
    expect(problemas).toEqual([])
  })

  it('detecta la fórmula vieja y variantes, pero permite comentarios y el helper', () => {
    const copias = [
      "const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s}Z`)",
      'const iso = s["endsWith"]("Z") ? s : s + "Z"',
      'const iso = `${s}Z`',
      'const iso = s + "Z"',
    ]
    for (const copia of copias) expect(verificar(copia).some(m => m.ruleId === 'fechas/compartida')).toBe(true)
    expect(verificar("// antes: s.endsWith('Z')\nconst d = kickoffDate(s); const ui = <span>{d?.getTime()}</span>")).toEqual([])
  })
})
