import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getUserAndProfile } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/gate'
import { Toaster } from '@/components/ui/sonner'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = await getUserAndProfile()
  if (!isAdmin(user?.id)) notFound()

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
