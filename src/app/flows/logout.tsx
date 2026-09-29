import { maskEmail } from '../format'
import { ui } from '../copy'
import { Avatar } from '../kit/Avatar'
import type { FlowImpl, StepProps } from './types'
import { ConfirmStep } from './steps/ConfirmStep'

// Log out (auth.logout): one confirm step. [Log out] returns this phone to Welcome, remembering
// the account; its screens and drafts are discarded. Money still arrives while logged out (an
// unread notification and a toast).

type Draft = Record<string, never>

function LogoutBody({ ctx }: StepProps<Draft>) {
  const account = ctx.app.persona(ctx.persona)
  const email = ctx.content.personas.personas.find((p) => p.id === ctx.persona)?.login?.email
  return (
    <ConfirmStep title={ui.logout.title} body={ui.logout.body}>
      {account && (
        <div className="mt-4 flex items-center gap-3.5 border border-line-200 bg-surface px-4 py-3.5">
          <Avatar persona={account} size={44} />
          <div className="min-w-0">
            <p className="truncate font-body text-body font-semibold text-navy-900">
              {account.displayName} · {account.handle}
            </p>
            {email && <p className="font-body text-body-s text-grey-600">{maskEmail(email)}</p>}
          </div>
        </div>
      )}
    </ConfirmStep>
  )
}

export const logoutFlow: FlowImpl<Draft> = {
  id: 'logout',
  title: (ctx) => (ctx.shell === 'consumer' ? ui.hubs.titles.profile : ui.hubs.titles.settings),
  tone: (ctx) => (ctx.shell === 'consumer' ? 'light' : 'business'),
  init: () => ({}),
  steps: [
    {
      id: 'confirm',
      screen: 'auth.logout',
      kind: 'confirm',
      Screen: LogoutBody,
      primary: () => ({ label: ui.logout.confirm, tone: 'navy', enabled: true }),
      secondary: (_d, _ctx, api) => ({ kind: 'outline', label: ui.logout.cancel, onPress: api.leave }),
      onPrimary: (_d, ctx) => ctx.app.actions.logout(ctx.slot),
    },
  ],
  commits: [],
}
