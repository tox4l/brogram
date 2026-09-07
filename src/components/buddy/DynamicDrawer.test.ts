import { describe, expect, it, vi } from 'vitest'

// W4FIX-B2 ruling 1: "The drawer itself mounts through next/dynamic({ ssr:
// false }) from its trigger so its chunk loads on first open, not on every
// route." `next/dynamic` is mocked to a synchronous stand-in (the same
// approach `ShaderSurface.test.tsx` uses) purely to capture what
// `DynamicDrawer.tsx` passes it -- the loader function and the options
// object -- without depending on `React.lazy`/`Suspense` timing.
const dynamicSpy = vi.hoisted(() => ({
  loader: undefined as (() => Promise<unknown>) | undefined,
  options: undefined as { ssr?: boolean } | undefined,
}))

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>, options?: { ssr?: boolean }) => {
    dynamicSpy.loader = loader
    dynamicSpy.options = options
    return function StubbedDynamicDrawer() {
      return null
    }
  },
}))

describe('DynamicDrawer', () => {
  it('passes ssr: false -- the drawer starts closed and has nothing to contribute to server-rendered HTML', async () => {
    await import('./DynamicDrawer')
    expect(dynamicSpy.options).toEqual({ ssr: false })
  })

  it("its loader resolves to the real BuddyDrawer export, not a stand-in -- BuddyButton's swap changes only the import path, not the component", async () => {
    await import('./DynamicDrawer')
    const { BuddyDrawer } = await import('./Drawer')
    await expect(dynamicSpy.loader!()).resolves.toBe(BuddyDrawer)
  })
})
