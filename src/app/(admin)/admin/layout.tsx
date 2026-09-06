import type { ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'

// The admin gate lives one level up, in src/app/(admin)/layout.tsx, so it
// covers every route in the group. This layout is chrome only.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex items-baseline justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Velocity</p>
          <h1 className="text-xl font-semibold text-foreground">Admin</h1>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Toaster />
    </div>
  )
}
