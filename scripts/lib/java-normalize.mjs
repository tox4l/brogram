// Java rejects two public top-level classes in one source file. Exercise
// fixtures declare `public class Main`, so the reference solution's
// `public class Solution` must drop its `public` modifier before the two
// are concatenated into a single Judge0 submission.
const PUBLIC_SOLUTION_RE = /\bpublic\s+((?:final\s+|abstract\s+)?class\s+Solution\b)/g

/** Strips the `public` modifier from a top-level `class Solution` declaration. */
export function normalizeJavaSolution(source) {
  return source.replace(PUBLIC_SOLUTION_RE, '$1')
}
