import { Badge } from '@/components/ui/badge'
import type { AccountStatus } from '@/lib/contracts'

/**
 * One look per status. Only `banned` uses the destructive (red) token: it is
 * the single real accent in the palette, reserved for the state that actually
 * blocks sign-in. Everything below it is a grayscale escalation ramp using
 * existing badge variants only -- no new colors.
 */
const STATUS_CONFIG: Record<AccountStatus, { label: string; variant: 'outline' | 'secondary' | 'destructive'; className?: string }> = {
  active: { label: 'Active', variant: 'outline', className: 'border-border/60 text-muted-foreground' },
  warned: { label: 'Warned', variant: 'secondary' },
  restricted: { label: 'Restricted', variant: 'outline', className: 'border-foreground/40 text-foreground' },
  banned: { label: 'Banned', variant: 'destructive' },
}

export function StatusBadge({ status }: { status: AccountStatus }) {
  const config = STATUS_CONFIG[status]
  return (
    <Badge variant={config.variant} className={config.className} data-status={status}>
      {config.label}
    </Badge>
  )
}
