import { Language, Parser, type Node } from 'web-tree-sitter'

/**
 * Structural grading for Java: assertions about the shape of a program rather
 * than its output. An exercise that says "Circle and Square must both extend an
 * abstract Shape" cannot be checked by stdout alone - a student can pass every
 * output test with one long if/else. These checks close that hole.
 *
 * Convention (a ruling, mirrored in docs/prompts/agents/03-author.md): a
 * TestCase whose `input` parses as JSON with a top-level `structure` key is a
 * structural test and its `expected` is the string "ok". The engine evaluates it
 * with this checker instead of compiling and running the program, so a
 * structural test never needs a fixture and never costs a JVM run.
 *
 *   {
 *     "structure": {
 *       "types": [
 *         { "name": "Shape", "kind": "class", "abstract": true,
 *           "methods": [{ "name": "area", "params": 0, "abstract": true }] },
 *         { "name": "Circle", "extends": "Shape", "implements": ["Fee"],
 *           "fields": [{ "name": "r", "modifiers": ["private", "final"] }],
 *           "constructors": [{ "params": 1 }],
 *           "methods": [{ "name": "area", "params": 0, "overrides": true }] }
 *       ]
 *     }
 *   }
 */

export interface MethodAssertion {
  name: string
  /** Declared parameter count. Omit to accept any arity. */
  params?: number
  static?: boolean
  abstract?: boolean
  final?: boolean
  /** True when the method must have the signature of a supertype method declared in the same source. */
  overrides?: boolean
  visibility?: 'public' | 'protected' | 'private' | 'package'
}

export interface FieldAssertion {
  name: string
  /** Every listed modifier must be present, e.g. ["private", "final"]. */
  modifiers?: string[]
}

export interface ConstructorAssertion {
  params?: number
}

export interface TypeAssertion {
  name: string
  kind?: 'class' | 'interface' | 'enum'
  abstract?: boolean
  final?: boolean
  extends?: string
  implements?: string[]
  methods?: MethodAssertion[]
  fields?: FieldAssertion[]
  constructors?: ConstructorAssertion[]
}

export interface StructureAssertions {
  types: TypeAssertion[]
}

export interface StructureResult {
  ok: boolean
  /** One sentence per unmet assertion, in the order they were declared. */
  failures: string[]
}

export interface JavaStructureChecker {
  check(source: string, assertions: StructureAssertions): StructureResult
}

/** The `expected` value every structural test carries. */
export const STRUCTURE_OK = 'ok'

const MODIFIER_KEYWORDS = new Set(['public', 'protected', 'private', 'abstract', 'static', 'final', 'strictfp', 'default', 'synchronized', 'native', 'transient', 'volatile'])

interface MethodInfo { name: string; params: number; modifiers: Set<string>; abstract: boolean }
interface FieldInfo { name: string; modifiers: Set<string> }
interface TypeInfo {
  name: string
  kind: 'class' | 'interface' | 'enum'
  modifiers: Set<string>
  superclass: string | null
  interfaces: string[]
  methods: MethodInfo[]
  fields: FieldInfo[]
  constructors: number[]
}

/** `java.util.List<String>` and `List<String>` both read as `List`. */
function simpleTypeName(text: string): string {
  const base = text.split('<')[0].trim()
  const parts = base.split('.')
  return parts[parts.length - 1].trim()
}

function modifiersOf(node: Node): Set<string> {
  const holder = node.children.find(child => child?.type === 'modifiers')
  if (!holder) return new Set()
  return new Set(holder.text.split(/\s+/).filter(word => MODIFIER_KEYWORDS.has(word)))
}

function parameterCount(node: Node): number {
  const parameters = node.childForFieldName('parameters')
  if (!parameters) return 0
  return parameters.namedChildren.filter(child => child?.type === 'formal_parameter' || child?.type === 'spread_parameter').length
}

function supertypes(node: Node): { superclass: string | null; interfaces: string[] } {
  let superclass: string | null = null
  const interfaces: string[] = []
  for (const child of node.namedChildren) {
    if (!child) continue
    // `class C extends S` nests the type inside a `superclass` node; both
    // `class C implements A, B` and `interface I extends A, B` nest a type_list.
    if (child.type === 'superclass') {
      const named = child.namedChildren.find(inner => Boolean(inner))
      if (named) superclass = simpleTypeName(named.text)
    } else if (child.type === 'super_interfaces' || child.type === 'extends_interfaces') {
      const list = child.namedChildren.find(inner => inner?.type === 'type_list') ?? child
      for (const entry of list.namedChildren) if (entry) interfaces.push(simpleTypeName(entry.text))
    }
  }
  return { superclass, interfaces }
}

function collectTypes(root: Node): Map<string, TypeInfo> {
  const types = new Map<string, TypeInfo>()
  const visit = (node: Node): void => {
    const kind = node.type === 'class_declaration' ? 'class' : node.type === 'interface_declaration' ? 'interface' : node.type === 'enum_declaration' ? 'enum' : null
    if (kind) {
      const name = node.childForFieldName('name')?.text ?? ''
      const { superclass, interfaces } = supertypes(node)
      const info: TypeInfo = { name, kind, modifiers: modifiersOf(node), superclass, interfaces, methods: [], fields: [], constructors: [] }
      const body = node.childForFieldName('body')
      for (const member of body?.namedChildren ?? []) {
        if (!member) continue
        if (member.type === 'method_declaration') {
          const modifiers = modifiersOf(member)
          info.methods.push({
            name: member.childForFieldName('name')?.text ?? '',
            params: parameterCount(member),
            modifiers,
            // An interface method with no body is abstract without saying so.
            abstract: modifiers.has('abstract') || (kind === 'interface' && !member.childForFieldName('body') && !modifiers.has('default') && !modifiers.has('static')),
          })
        } else if (member.type === 'field_declaration' || member.type === 'constant_declaration') {
          const modifiers = modifiersOf(member)
          for (const declarator of member.namedChildren) {
            if (declarator?.type !== 'variable_declarator') continue
            info.fields.push({ name: declarator.childForFieldName('name')?.text ?? '', modifiers })
          }
        } else if (member.type === 'constructor_declaration') {
          info.constructors.push(parameterCount(member))
        }
      }
      if (name && !types.has(name)) types.set(name, info)
    }
    for (const child of node.namedChildren) if (child) visit(child)
  }
  visit(root)
  return types
}

/** Walks extends/implements among the types declared in this source only. */
function inheritedMethods(types: Map<string, TypeInfo>, start: TypeInfo): MethodInfo[] {
  const found: MethodInfo[] = []
  const seen = new Set<string>([start.name])
  const queue = [start.superclass, ...start.interfaces].filter((name): name is string => Boolean(name))
  while (queue.length) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    const parent = types.get(name)
    if (!parent) continue
    found.push(...parent.methods)
    if (parent.superclass) queue.push(parent.superclass)
    queue.push(...parent.interfaces)
  }
  return found
}

function visibilityOf(modifiers: Set<string>): MethodAssertion['visibility'] {
  for (const level of ['public', 'protected', 'private'] as const) if (modifiers.has(level)) return level
  return 'package'
}

function checkType(types: Map<string, TypeInfo>, assertion: TypeAssertion, failures: string[]): void {
  const info = types.get(assertion.name)
  if (!info) {
    failures.push(`${assertion.kind ?? 'class'} ${assertion.name} is missing.`)
    return
  }
  if (assertion.kind && info.kind !== assertion.kind) failures.push(`${assertion.name} must be declared as ${assertion.kind}, not ${info.kind}.`)
  if (assertion.abstract === true && !(info.modifiers.has('abstract') || info.kind === 'interface')) failures.push(`${assertion.name} must be abstract.`)
  if (assertion.abstract === false && info.modifiers.has('abstract')) failures.push(`${assertion.name} must not be abstract.`)
  if (assertion.final === true && !info.modifiers.has('final')) failures.push(`${assertion.name} must be final.`)
  if (assertion.final === false && info.modifiers.has('final')) failures.push(`${assertion.name} must not be final.`)
  if (assertion.extends && info.superclass !== assertion.extends) failures.push(`${assertion.name} must extend ${assertion.extends}.`)
  for (const name of assertion.implements ?? []) {
    if (!info.interfaces.includes(name)) failures.push(`${assertion.name} must implement ${name}.`)
  }

  for (const wanted of assertion.methods ?? []) {
    const candidates = info.methods.filter(method => method.name === wanted.name && (wanted.params === undefined || method.params === wanted.params))
    const arity = wanted.params === undefined ? '' : ` taking ${wanted.params} parameter${wanted.params === 1 ? '' : 's'}`
    if (!candidates.length) {
      failures.push(`${assertion.name} must declare a method ${wanted.name}${arity}.`)
      continue
    }
    const inherited = wanted.overrides ? inheritedMethods(types, info) : []
    const match = candidates.find(method =>
      (wanted.static === undefined || method.modifiers.has('static') === wanted.static) &&
      (wanted.abstract === undefined || method.abstract === wanted.abstract) &&
      (wanted.final === undefined || method.modifiers.has('final') === wanted.final) &&
      (wanted.visibility === undefined || visibilityOf(method.modifiers) === wanted.visibility) &&
      (!wanted.overrides || inherited.some(parent => parent.name === method.name && parent.params === method.params)))
    if (match) continue
    if (wanted.overrides) failures.push(`${assertion.name}.${wanted.name}${arity} must override a method it inherits.`)
    else failures.push(`${assertion.name}.${wanted.name}${arity} does not have the required modifiers.`)
  }

  for (const wanted of assertion.fields ?? []) {
    const field = info.fields.find(candidate => candidate.name === wanted.name)
    if (!field) {
      failures.push(`${assertion.name} must declare a field ${wanted.name}.`)
      continue
    }
    const missing = (wanted.modifiers ?? []).filter(modifier => !field.modifiers.has(modifier))
    if (missing.length) failures.push(`${assertion.name}.${wanted.name} must be ${missing.join(' ')}.`)
  }

  for (const wanted of assertion.constructors ?? []) {
    const arity = wanted.params
    if (arity === undefined ? info.constructors.length === 0 : !info.constructors.includes(arity)) {
      failures.push(`${assertion.name} must declare a constructor${arity === undefined ? '' : ` taking ${arity} parameter${arity === 1 ? '' : 's'}`}.`)
    }
  }
}

/** Reads the structural-test convention off a TestCase input; null means "run the program". */
export function parseStructureAssertions(input: string): StructureAssertions | null {
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const structure = (parsed as { structure?: unknown }).structure
  if (!structure || typeof structure !== 'object' || Array.isArray(structure)) return null
  const types = (structure as { types?: unknown }).types
  if (!Array.isArray(types)) return null
  return { types: types as TypeAssertion[] }
}

export interface JavaStructureSources {
  /** Where the tree-sitter runtime wasm lives; omit in Node to use the package copy. */
  runtimeWasm?: string
  /** The tree-sitter-java grammar wasm. */
  grammarWasm: string
}

/** One parser per worker; tree-sitter is synchronous once its wasm is up. */
export async function createJavaStructureChecker(sources: JavaStructureSources): Promise<JavaStructureChecker> {
  await Parser.init(sources.runtimeWasm ? { locateFile: () => sources.runtimeWasm! } : undefined)
  const language = await Language.load(sources.grammarWasm)
  const parser = new Parser()
  parser.setLanguage(language)
  return {
    check(source, assertions) {
      const tree = parser.parse(source)
      if (!tree?.rootNode) return { ok: false, failures: ['Your Java source could not be parsed.'] }
      const types = collectTypes(tree.rootNode)
      const failures: string[] = []
      for (const assertion of assertions.types ?? []) checkType(types, assertion, failures)
      tree.delete()
      return { ok: failures.length === 0, failures }
    },
  }
}
