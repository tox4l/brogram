'use client'

import dynamic from 'next/dynamic'

/**
 * W4FIX-B2 ruling 1's last sentence: "The drawer itself mounts through
 * `next/dynamic({ ssr: false })` from its trigger so its chunk loads on
 * first open, not on every route." `BuddyDrawer` (`./Drawer.tsx`) measures
 * at 96.7 KB of its own component code (the message list, the composer,
 * the `motion/react` bubble animations) in a real build -- and its one call
 * site, `src/components/shell/BuddyButton.tsx`, imports it statically today
 * (`import { BuddyDrawer } from '@/components/buddy/Drawer'`), so that
 * whole chunk ships in the entry bundle of every authenticated route,
 * opened or not.
 *
 * `BuddyButton.tsx` is outside this lane's owned paths (only
 * `src/components/buddy/**` is), so it is not edited here -- this is the
 * drop-in replacement it needs: swap its import for
 * `import DynamicBuddyDrawer from '@/components/buddy/DynamicDrawer'` and
 * render `<DynamicBuddyDrawer .../>` with the same `open`/`onOpenChange`
 * props `<BuddyDrawer>` already takes. See this lane's report for the
 * measured effect of that one-line change (confirmed in a scratch build:
 * it clears `/lesson/[cloId]`'s remaining budget overage).
 *
 * `ssr: false` is correct, not just permitted, here: the drawer starts
 * closed on every mount (`open` is caller state, always `false` on first
 * paint) and reads `useSession`/`useQuery`/`usePathname` the instant it
 * would render on the server, none of which have a meaningful value before
 * hydration -- there is nothing for this component to contribute to the
 * server-rendered HTML.
 */
const DynamicBuddyDrawer = dynamic(() => import('./Drawer').then((mod) => mod.BuddyDrawer), { ssr: false })

export default DynamicBuddyDrawer
