import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Section } from './Section'

export function LoginSection() {
  return (
    <Section id="login" title="Login" caption="Renders for real at its own route; not duplicated here since it needs no fixture data.">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-5">
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">The sign-in screen is a magic-link form with no session dependency, so it is best viewed at its real route rather than re-mounted here.</p>
        <Link href="/login" className={buttonVariants({ variant: 'outline' })}>Open /login</Link>
      </div>
    </Section>
  )
}
