import { fill, ui } from '../copy'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { formatMinor } from '@domain/money'
import { selectAvailable } from '@store/selectors'
import { salesToday } from '@store/selectors'
import { useApp, useUnread } from '../state/AppContext'
import { BalanceBand } from './chrome/BalanceBand'
import { BannerSlot } from './chrome/Banner'
import { HomeHeader } from './chrome/HomeHeader'
import { PhoneScreen } from './chrome/PhoneScreen'
import { Tile, TileGrid } from './chrome/Tile'
import { iconFor } from './icons'
import { isImplemented } from './implemented'
import { usePhoneNav } from './nav'
import { usePersonaPhone } from './PhoneContext'
import { BELL, HOME_SCREENS, type HubId, homeOf, registeredRows, registeredTiles, type Target } from './registry'

// Home: the header, the navy balance band and up to four tiles (2 × 2). A tile whose feature is
// not live yet is absent (never disabled): it must be in content/homes.yaml, in the registry and
// built. A hub tile shows only when at least one of its rows is built. Fits 700 px on the stage
// and 664 px in phone mode without scrolling.

export function HomeScreen() {
  const app = useApp()
  const { persona, shell } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const balance = useLedger(selectAvailable(persona))
  const unread = useUnread(persona)
  const account = app.persona(persona)
  const home = homeOf(app.content.homes, shell, persona)
  const state = useLedger((s) => s)
  if (!account || !home) return null

  const visible = (target: Target): boolean =>
    target.kind === 'hub'
      ? registeredRows(home, target.id).some((r) => isImplemented(r.target, shell))
      : isImplemented(target, shell)

  /** The live line under a tile's label. */
  const lineOf = (subline: string | undefined): string | null => {
    if (subline === 'salesToday') {
      const t = salesToday(state, persona, node.now(), app.content.config.t0.tz)
      return fill(ui.hubs.sublines.salesToday, { count: t.count, gross: formatMinor(t.gross) })
    }
    return null
  }

  return (
    <PhoneScreen id={HOME_SCREENS[shell]} header={account.kind === 'person' ? 'light' : 'navy'} bare banner={false}>
      <HomeHeader
        persona={account}
        unread={unread}
        onAvatar={() => nav.open({ kind: 'hub', id: home.avatar as HubId })}
        onBell={() => (isImplemented(BELL, shell) ? nav.open(BELL) : undefined)}
      />
      <BannerSlot />
      <BalanceBand
        persona={persona}
        balance={balance}
        rate={state.config.rate}
        bordered={account.kind === 'business'}
      />
      <TileGrid>
        {registeredTiles(home)
          .filter((t) => visible(t.target))
          .map((t) => (
            <Tile
              key={t.tile}
              id={t.tile}
              icon={iconFor(t.entry.icon)}
              label={ui.tiles[t.tile as keyof typeof ui.tiles]}
              line={lineOf(t.entry.subline)}
              onPress={() => nav.open(t.target)}
            />
          ))}
      </TileGrid>
    </PhoneScreen>
  )
}
