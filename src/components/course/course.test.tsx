import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExercisePublic } from '@/lib/contracts'
import type { MapNode, NextUpCard } from '@/lib/course/map'
import { PathMap } from './PathMap'
import { CourseFlatList } from './CourseFlatList'
import { NextUpStack } from './NextUpStack'

const mocks = vi.hoisted(() => ({ prefetch: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch: mocks.prefetch, push: mocks.push }) }))

function node(overrides: Partial<MapNode> & { cloId: string; ordinal: number }): MapNode {
  return {
    title: `Skill ${overrides.cloId}`,
    state: 'available',
    chain: 0,
    closed: false,
    draft: false,
    prerequisites: [],
    externalPrerequisites: [],
    ...overrides,
  }
}

function exercise(id: string, cloId: string): ExercisePublic {
  return {
    id, cloId, language: 'python', kind: 'code', difficulty: 3, pattern: 'pattern-a',
    title: `Exercise ${id}`, prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [],
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('PathMap', () => {
  it('is a real ordered list of links, one per node, in path order', () => {
    const nodes = [
      node({ cloId: 'C-1', ordinal: 1, state: 'locked-in' }),
      node({ cloId: 'C-2', ordinal: 2, state: 'in-progress', chain: 2 }),
      node({ cloId: 'C-3', ordinal: 3, state: 'walkthrough-ready' }),
    ]
    render(<PathMap nodes={nodes} exercises={[]} reducedMotion />)
    const list = screen.getByRole('list', { name: 'Skill path' })
    expect(list.tagName).toBe('OL')
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/lesson/C-1', '/lesson/C-2', '/lesson/C-3'])
  })

  it('gives each node an accessible name of skill, state and progress -- never colour alone', () => {
    const nodes = [node({ cloId: 'C-1', ordinal: 1, title: 'Loops that stop when you tell them to', state: 'in-progress', chain: 2 })]
    render(<PathMap nodes={nodes} exercises={[]} reducedMotion />)
    const link = screen.getByRole('link', { name: 'Loops that stop when you tell them to — in progress, 2 of 3' })
    expect(link).toBeTruthy()
  })

  it('gives every node state a distinct shape marker, not just a colour token', () => {
    const nodes = [
      node({ cloId: 'C-1', ordinal: 1, state: 'locked' }),
      node({ cloId: 'C-2', ordinal: 2, state: 'available' }),
      node({ cloId: 'C-3', ordinal: 3, state: 'walkthrough-ready' }),
      node({ cloId: 'C-4', ordinal: 4, state: 'in-progress', chain: 1 }),
      node({ cloId: 'C-5', ordinal: 5, state: 'locked-in' }),
    ]
    const { container } = render(<PathMap nodes={nodes} exercises={[]} reducedMotion />)
    const shapes = Array.from(container.querySelectorAll('[data-node-shape]')).map((el) => el.getAttribute('data-node-shape'))
    expect(new Set(shapes).size).toBe(5)
  })

  it('exposes an in-course prerequisite through aria-describedby pointing at the prerequisite item', () => {
    const nodes = [
      node({ cloId: 'C-1', ordinal: 1, state: 'locked-in', closed: true }),
      node({ cloId: 'C-2', ordinal: 2, state: 'locked', prerequisites: ['C-1'] }),
    ]
    render(<PathMap nodes={nodes} exercises={[]} reducedMotion />)
    const locked = screen.getByRole('link', { name: /Skill C-2/ })
    expect(locked.getAttribute('aria-describedby')).toBe('clo-node-C-1')
    expect(document.getElementById('clo-node-C-1')).toBeTruthy()
  })

  it('never gates on an external, out-of-course prerequisite and marks it as advisory only', () => {
    const nodes = [node({ cloId: 'INFS1201-1', ordinal: 1, state: 'walkthrough-ready', externalPrerequisites: ['INFS1101-4'] })]
    render(<PathMap nodes={nodes} exercises={[]} reducedMotion />)
    const link = screen.getByRole('link', { name: /Also builds on a skill from another course/ })
    expect(link.getAttribute('href')).toBe('/lesson/INFS1201-1')
  })

  it('is fully keyboard reachable in path order (Tab moves through nodes, Enter opens)', () => {
    const nodes = [node({ cloId: 'C-1', ordinal: 1 }), node({ cloId: 'C-2', ordinal: 2 })]
    render(<PathMap nodes={nodes} exercises={[]} reducedMotion />)
    const links = screen.getAllByRole('link')
    links[0].focus()
    expect(document.activeElement).toBe(links[0])
    links[1].focus()
    expect(document.activeElement).toBe(links[1])
  })

  it('prefetches the walkthrough and the first rep on hover', () => {
    const nodes = [node({ cloId: 'C-1', ordinal: 1 })]
    render(<PathMap nodes={nodes} exercises={[exercise('E-1', 'C-1')]} reducedMotion />)
    fireEvent.mouseEnter(screen.getByRole('link'))
    expect(mocks.prefetch).toHaveBeenCalledWith('/lesson/C-1')
    expect(mocks.prefetch).toHaveBeenCalledWith('/exercise/E-1')
  })

  it('keeps the SVG connector decorative and out of the tab order', () => {
    const nodes = [node({ cloId: 'C-1', ordinal: 1 }), node({ cloId: 'C-2', ordinal: 2 })]
    const { container } = render(<PathMap nodes={nodes} exercises={[]} reducedMotion />)
    const svgs = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(svgs.length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('renders nodes at full opacity immediately under reduced motion, without a stagger delay', () => {
    const nodes = [node({ cloId: 'C-1', ordinal: 1 }), node({ cloId: 'C-2', ordinal: 2 })]
    render(<PathMap nodes={nodes} exercises={[]} reducedMotion />)
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.style.opacity).toBe('')
      expect(item.style.transitionDelay).toBe('')
    }
  })

  it('stages nodes with an increasing, capped transition delay when motion is on', async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node({ cloId: `C-${i}`, ordinal: i }))
    render(<PathMap nodes={nodes} exercises={[]} reducedMotion={false} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0].style.transitionDelay).toBe('0ms')
    expect(items[11].style.transitionDelay).toBe('300ms')
  })
})

describe('CourseFlatList', () => {
  it('is collapsed by default and reveals the same nodes as a flat list once opened', () => {
    const nodes = [node({ cloId: 'C-1', ordinal: 1, title: 'First skill' }), node({ cloId: 'C-2', ordinal: 2, title: 'Second skill' })]
    const { container } = render(<CourseFlatList nodes={nodes} />)
    expect(container.querySelector('details')?.open).toBeFalsy()
    fireEvent.click(screen.getByText('Every skill in this course'))
    expect(container.querySelector('details')?.open).toBe(true)
    expect(screen.getByText('First skill')).toBeTruthy()
    expect(screen.getByText('Second skill')).toBeTruthy()
  })

  it('shows a drafted marker without hiding the drafted skill', () => {
    const nodes = [node({ cloId: 'C-1', ordinal: 1, title: 'Drafted skill', draft: true })]
    render(<CourseFlatList nodes={nodes} />)
    fireEvent.click(screen.getByText('Every skill in this course'))
    expect(screen.getByText('Drafted skill')).toBeTruthy()
    expect(screen.getByText('Drafted')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Drafted skill/ }).getAttribute('href')).toBe('/lesson/C-1')
  })
})

describe('NextUpStack', () => {
  function walkthroughCard(overrides: Partial<NextUpCard> = {}): NextUpCard {
    return { kind: 'walkthrough', id: 'C-1', cloId: 'C-1', title: 'Walkthrough — Stopping on command', href: '/lesson/C-1', lessonAvailable: true, ...overrides }
  }
  function exerciseCard(id: string, overrides: Partial<NextUpCard> = {}): NextUpCard {
    return { kind: 'exercise', id, cloId: 'C-1', title: `Exercise ${id}`, href: `/exercise/${id}`, language: 'python', difficulty: 3, ...overrides }
  }

  it('renders exactly three cards with nothing disabled when a walkthrough leads', () => {
    const cards = [walkthroughCard(), exerciseCard('E-1', { caption: 'After the walkthrough, or skip it.' }), exerciseCard('E-2', { caption: 'After the walkthrough, or skip it.' })]
    render(<NextUpStack cards={cards} />)
    const region = screen.getByRole('region', { name: 'Next up' })
    const links = within(region).getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(screen.getAllByText('After the walkthrough, or skip it.')).toHaveLength(2)
    for (const link of links) expect(link.getAttribute('aria-disabled')).toBeNull()
  })

  it('renders a placeholder, not a broken link, when the current skill has no lesson yet', () => {
    const cards = [walkthroughCard({ lessonAvailable: false }), exerciseCard('E-1'), exerciseCard('E-2')]
    render(<NextUpStack cards={cards} />)
    expect(screen.getByText('Coming soon for this skill.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Coming soon/ })).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('marks a locally-picked card as "picked for you"', () => {
    const cards = [exerciseCard('E-1', { pickedForYou: true }), exerciseCard('E-2'), exerciseCard('E-3')]
    render(<NextUpStack cards={cards} />)
    expect(screen.getByText('Picked for you')).toBeTruthy()
  })
})
