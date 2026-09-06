// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createJavaStructureChecker, parseStructureAssertions, type JavaStructureChecker, type StructureAssertions } from './java-structure'
import smoke from '../../../seed/exercises/smoke.json'

let checker: JavaStructureChecker
beforeAll(async () => {
  checker = await createJavaStructureChecker({
    runtimeWasm: 'node_modules/web-tree-sitter/web-tree-sitter.wasm',
    grammarWasm: 'node_modules/tree-sitter-java/tree-sitter-java.wasm',
  })
}, 60000)

const SHAPES = smoke.exercises.find(exercise => exercise.language === 'java')!.referenceSolution

const SOURCE = `interface Fee {
    double fee(double amount);
}
abstract class Account implements Fee {
    private final String owner;
    protected static int opened = 0;
    Account(String owner) { this.owner = owner; }
    abstract double balance();
    public double fee(double amount) { return amount; }
    String label(String prefix, int width) { return prefix; }
}
final class Savings extends Account {
    Savings(String owner) { super(owner); }
    Savings(String owner, double start) { super(owner); }
    double balance() { return 0; }
}
`

const check = (source: string, types: StructureAssertions['types']) => checker.check(source, { types })

describe('java structural checks', () => {
  it('reads the structural-test convention off a TestCase input', () => {
    expect(parseStructureAssertions('{"structure":{"types":[{"name":"Solution"}]}}')).toEqual({ types: [{ name: 'Solution' }] })
    expect(parseStructureAssertions('square 2')).toBeNull()
    expect(parseStructureAssertions('[1, 2]')).toBeNull()
    expect(parseStructureAssertions('{"other":1}')).toBeNull()
  })

  it('verifies class presence and reports a missing one by name', () => {
    expect(check(SOURCE, [{ name: 'Savings' }, { name: 'Account' }]).ok).toBe(true)
    expect(check(SOURCE, [{ name: 'Checking' }]).failures).toEqual(['class Checking is missing.'])
  })

  it('verifies kind, extends and implements', () => {
    expect(check(SOURCE, [{ name: 'Fee', kind: 'interface' }, { name: 'Savings', extends: 'Account' }, { name: 'Account', implements: ['Fee'] }]).ok).toBe(true)
    expect(check(SOURCE, [{ name: 'Savings', extends: 'Fee' }]).failures).toEqual(['Savings must extend Fee.'])
    expect(check(SOURCE, [{ name: 'Savings', implements: ['Fee'] }]).failures).toEqual(['Savings must implement Fee.'])
    expect(check(SOURCE, [{ name: 'Fee', kind: 'class' }]).failures).toEqual(['Fee must be declared as class, not interface.'])
  })

  it('verifies abstract and final modifiers on a type', () => {
    expect(check(SOURCE, [{ name: 'Account', abstract: true }, { name: 'Savings', final: true, abstract: false }]).ok).toBe(true)
    expect(check(SOURCE, [{ name: 'Savings', abstract: true }]).failures).toEqual(['Savings must be abstract.'])
    expect(check(SOURCE, [{ name: 'Account', final: true }]).failures).toEqual(['Account must be final.'])
  })

  it('verifies method presence with a parameter count and modifiers', () => {
    expect(check(SOURCE, [{ name: 'Account', methods: [{ name: 'label', params: 2 }, { name: 'balance', params: 0, abstract: true }, { name: 'fee', params: 1, visibility: 'public' }] }]).ok).toBe(true)
    expect(check(SOURCE, [{ name: 'Account', methods: [{ name: 'label', params: 1 }] }]).failures).toEqual(['Account must declare a method label taking 1 parameter.'])
    expect(check(SOURCE, [{ name: 'Account', methods: [{ name: 'label', params: 2, static: true }] }]).failures).toEqual(['Account.label taking 2 parameters does not have the required modifiers.'])
  })

  it('verifies overrides against supertypes declared in the same source', () => {
    expect(check(SOURCE, [{ name: 'Savings', methods: [{ name: 'balance', params: 0, overrides: true }] }]).ok).toBe(true)
    // fee() is inherited from Account's implementation of Fee, two links up the chain.
    expect(check(SOURCE, [{ name: 'Account', methods: [{ name: 'fee', params: 1, overrides: true }] }]).ok).toBe(true)
    expect(check(SOURCE, [{ name: 'Account', methods: [{ name: 'label', params: 2, overrides: true }] }]).failures).toEqual(['Account.label taking 2 parameters must override a method it inherits.'])
  })

  it('verifies field presence with modifiers and constructor arity', () => {
    expect(check(SOURCE, [{ name: 'Account', fields: [{ name: 'owner', modifiers: ['private', 'final'] }, { name: 'opened', modifiers: ['static'] }], constructors: [{ params: 1 }] }]).ok).toBe(true)
    expect(check(SOURCE, [{ name: 'Savings', constructors: [{ params: 2 }, { params: 1 }] }]).ok).toBe(true)
    expect(check(SOURCE, [{ name: 'Account', fields: [{ name: 'owner', modifiers: ['public'] }] }]).failures).toEqual(['Account.owner must be public.'])
    expect(check(SOURCE, [{ name: 'Account', fields: [{ name: 'nickname' }] }]).failures).toEqual(['Account must declare a field nickname.'])
    expect(check(SOURCE, [{ name: 'Savings', constructors: [{ params: 3 }] }]).failures).toEqual(['Savings must declare a constructor taking 3 parameters.'])
  })

  it('accepts the Shapes reference solution and rejects a flattened one', () => {
    const shapes: StructureAssertions['types'] = [
      { name: 'Shape', abstract: true, methods: [{ name: 'area', params: 0, abstract: true }, { name: 'describe', params: 1 }] },
      { name: 'Circle', extends: 'Shape', constructors: [{ params: 1 }], fields: [{ name: 'r', modifiers: ['private', 'final'] }], methods: [{ name: 'area', params: 0, overrides: true }] },
      { name: 'Square', extends: 'Shape', methods: [{ name: 'area', params: 0, overrides: true }] },
      { name: 'Solution', methods: [{ name: 'describe', params: 2, static: true }] },
    ]
    expect(check(SHAPES, shapes)).toEqual({ ok: true, failures: [] })
    const flattened = 'public class Solution {\n  public static String describe(String kind, double a) { return "unknown"; }\n}\n'
    expect(check(flattened, shapes).failures).toEqual([
      'class Shape is missing.',
      'class Circle is missing.',
      'class Square is missing.',
    ])
  })
})
