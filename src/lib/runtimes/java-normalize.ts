// Keep this expression aligned with scripts/lib/java-normalize.mjs. Judge0
// compiles one Main.java file, so only the fixture's Main may remain public.
const PUBLIC_SOLUTION_RE = /\bpublic\s+((?:final\s+|abstract\s+)?class\s+Solution\b)/g

export function normalizeJavaSolution(source: string): string {
  return source.replace(PUBLIC_SOLUTION_RE, '$1')
}

export function buildJavaSource(code: string, fixture?: string): string {
  return `${fixture ? `${fixture}\n` : ''}${normalizeJavaSolution(code)}`
}
