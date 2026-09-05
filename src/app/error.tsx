'use client'

import { Button } from '@/components/ui/button'

export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-medium tracking-tight">Your progress is still yours.</h1>
      <p role="alert" className="text-muted-foreground">We could not load this part of your learning space. Try again in a moment.</p>
      <Button onClick={retry} className="w-fit">Try again</Button>
    </main>
  )
}
