import type { RuntimeEngine } from './worker-host'
import type { ExecutionOutput } from './shared'

type Typescript = typeof import('typescript')

function prepareSource(ts: Typescript, code: string): { code: string; fn?: string } {
  const source = ts.createSourceFile('student.js', code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS)
  const cuts: [number, number][] = []
  const functions: { name: string; exported: boolean }[] = []
  const exportedNames = new Set<string>()
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) exportedNames.add((item.propertyName ?? item.name).text)
      }
      cuts.push([statement.getStart(source), statement.getEnd()])
      continue
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
    const exported = modifiers.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
    for (const modifier of modifiers) {
      if (modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword) cuts.push([modifier.getStart(source), modifier.getEnd()])
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) functions.push({ name: statement.name.text, exported })
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
          functions.push({ name: declaration.name.text, exported })
        }
      }
    }
  }
  // Delete syntax tokens only: strings, comments, templates, and regexes remain
  // intact, unlike a global /export/ replacement over the student's source.
  for (const [start, end] of cuts.sort((left, right) => right[0] - left[0])) code = code.slice(0, start) + code.slice(end)
  return { code, fn: (functions.find((item) => item.exported || exportedNames.has(item.name)) ?? functions[0])?.name }
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}

export function createJsEngine(language: 'javascript' | 'typescript' = 'javascript'): RuntimeEngine {
  let compiler: Typescript | undefined
  let compilerLoading: Promise<Typescript> | undefined
  async function loadCompiler(): Promise<Typescript> {
    compilerLoading ??= import('typescript').then((module) => module.default ?? module)
    compiler = await compilerLoading
    return compiler
  }

  return {
    async warmup(_packages, progress) {
      progress('JavaScript')
      progress(language === 'typescript' ? 'typescript' : 'typescript syntax parser')
      await loadCompiler()
    },

    async execute(req, test) {
      const stdout: string[] = []
      const stderr: string[] = []
      const output = (actual: string, failureKind?: ExecutionOutput['failureKind']): ExecutionOutput => ({ actual, stdout: stdout.join('\n'), stderr: stderr.join('\n'), ...(failureKind ? { failureKind } : {}) })
      let code = req.code
      if (req.language === 'typescript') {
        const ts = compiler ?? await loadCompiler()
        const transpiled = ts.transpileModule(code, {
          fileName: 'student.ts',
          compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
          reportDiagnostics: true,
        })
        const errors = transpiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? []
        if (errors.length) {
          stderr.push(...errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')))
          return output('', 'compile-error')
        }
        code = transpiled.outputText
      }

      const prepared = prepareSource(compiler ?? await loadCompiler(), code)
      const fn = prepared.fn
      let args: unknown[] = []
      if (test && fn) {
        try {
          const parsed: unknown = JSON.parse(test.input)
          if (!Array.isArray(parsed)) throw new Error('Function test input must be a JSON array of arguments.')
          args = parsed
        } catch (error) {
          stderr.push(text(error))
          return output('', 'runtime-error')
        }
      }

      let execute: (console: object, args: unknown[]) => unknown
      try {
        // Each invocation owns new lexical state. The outer worker enforces the
        // hard deadline, including an infinite loop inside this Function.
        execute = new Function('console', '__args', `"use strict";\n${req.fixture ?? ''}\n${prepared.code}\n${test && fn ? `return ${fn}(...__args);` : ''}`) as typeof execute
      } catch (error) {
        stderr.push(text(error))
        return output('', 'compile-error')
      }

      const capture = (target: string[]) => (...values: unknown[]) => target.push(values.map(text).join(' '))
      const capturedConsole = { log: capture(stdout), info: capture(stdout), debug: capture(stdout), warn: capture(stderr), error: capture(stderr) }
      try {
        const value = await execute(capturedConsole, args)
        const actual = test && fn ? JSON.stringify(value) ?? 'undefined' : stdout.join('\n').trim()
        return output(actual)
      } catch (error) {
        stderr.push(text(error))
        return output('', 'runtime-error')
      }
    },
  }
}
