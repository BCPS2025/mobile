import { Clock } from 'lucide-react'
import { formatHundredths, formatMinor } from '@domain/money'
import type { AutoConvertSettings } from '@domain/types'
import { autoConvertAfter, autoConvertPreview, bankOf } from '@store/selectors'
import { fill, ui } from '../copy'
import { scheduleLine, stripText, whenText } from '../phone/autoconvert'
import { FactsCard } from '../phone/chrome/FactsCard'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { Switch } from '../phone/chrome/Switch'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Auto-convert (biz.autoconvert.*): on or off, when, how much of the balance, then the check and
// Save. It saves the schedule and shows it: nothing converts by itself, and nothing else depends
// on it. Turning it off skips the two steps in between.

type Schedule = AutoConvertSettings['schedule']
type Time = AutoConvertSettings['atLocal']

const SCHEDULES: readonly Schedule[] = ['daily', 'weekdays', 'weekly']
const TIMES: readonly Time[] = ['18:00', '20:00', '22:00', '23:00']

interface Draft {
  enabled: boolean
  schedule: Schedule
  atLocal: Time
  sharePct: number
  onlyOnDaysWithSales: boolean
  /** The settings were saved (the flow then ends on "Saved"). */
  saved: boolean
}

const scheduleLabels: Record<Schedule, string> = {
  daily: ui.autoConvert.daily,
  weekdays: ui.autoConvert.weekdays,
  weekly: ui.autoConvert.weekly,
}

/** The settings the business has now. */
const currentOf = (ctx: FlowCtx): AutoConvertSettings | undefined => ctx.state.merchant[ctx.persona]?.autoConvert

/** Businesses that sell have the "Only on days with sales" choice. */
const hasSales = (ctx: FlowCtx): boolean => ctx.shell === 'pos' || ctx.shell === 'studio'

/** The patch a save sends, and the settings it leaves. */
function patchOf(d: Draft, ctx: FlowCtx) {
  if (!d.enabled) return { enabled: false }
  return {
    enabled: true,
    schedule: d.schedule,
    atLocal: d.atLocal,
    sharePct: d.sharePct,
    ...(hasSales(ctx) ? { onlyOnDaysWithSales: d.onlyOnDaysWithSales } : {}),
  }
}

function afterOf(d: Draft, ctx: FlowCtx): AutoConvertSettings | undefined {
  const current = currentOf(ctx)
  return current ? autoConvertAfter(current, patchOf(d, ctx)) : undefined
}

function OnOffBody({ d, api }: StepProps<Draft>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3 font-display text-display-m text-navy-900">{ui.autoConvert.onTitle}</h2>
      <Switch
        label={ui.autoConvert.toggle}
        hint={ui.autoConvert.toggleHint}
        on={d.enabled}
        onChange={(enabled) => api.set({ enabled })}
        testId="auto-convert-switch"
      />
      <p className="mt-3 font-body text-body-s text-grey-600">{ui.autoConvert.conversionNote}</p>
    </div>
  )
}

/** A row of choices of which one is on: the segmented control and the times. */
function Choices<T extends string>({
  group,
  options,
  value,
  label,
  onPick,
  testId,
  columns,
}: {
  group: string
  options: readonly T[]
  value: T
  label: (o: T) => string
  onPick: (o: T) => void
  testId: string
  columns: string
}) {
  return (
    <div role="radiogroup" aria-label={group} className={`grid ${columns}`}>
      {options.map((o) => {
        const on = o === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented button that is a radio; the input would be hidden
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`${testId}-${o}`}
            onClick={() => onPick(o)}
            className={`min-h-12 border px-2 font-body text-body font-medium tnum ${
              on ? 'border-navy-900 bg-navy-900 text-white' : 'border-line-300 bg-surface text-navy-900'
            }`}
          >
            {label(o)}
          </button>
        )
      })}
    </div>
  )
}

function ScheduleBody({ d, api }: StepProps<Draft>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3.5 font-display text-display-m text-navy-900">{ui.autoConvert.scheduleTitle}</h2>
      <Choices
        group={ui.autoConvert.scheduleGroup}
        options={SCHEDULES}
        value={d.schedule}
        label={(s) => scheduleLabels[s]}
        onPick={(schedule) => api.set({ schedule })}
        testId="schedule"
        columns="grid-cols-3"
      />
      <p className="mt-5 mb-2 font-body text-caption font-medium tracking-[0.16em] text-grey-600">
        {ui.autoConvert.time}
      </p>
      <Choices
        group={ui.autoConvert.timeGroup}
        options={TIMES}
        value={d.atLocal}
        label={(t) => t}
        onPick={(atLocal) => api.set({ atLocal })}
        testId="time"
        columns="grid-cols-4 gap-2"
      />
    </div>
  )
}

function ShareBody({ d, ctx, api }: StepProps<Draft>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 font-display text-display-m text-navy-900">{ui.autoConvert.shareTitle}</h2>
      <p
        data-testid="share-value"
        className="py-6 text-center font-display text-[52px] leading-[56px] font-semibold tracking-[-0.02em] text-navy-900 tnum"
      >
        {fill(ui.autoConvert.shareValue, { pct: d.sharePct })}
      </p>
      <input
        type="range"
        className="share-range"
        data-testid="share-range"
        aria-label={ui.autoConvert.shareLabel}
        aria-valuetext={fill(ui.autoConvert.shareValue, { pct: d.sharePct })}
        min={10}
        max={100}
        step={10}
        value={d.sharePct}
        onChange={(e) => api.set({ sharePct: Number(e.target.value) })}
      />
      <div aria-hidden="true" className="flex justify-between font-body text-caption text-grey-600 tnum">
        <span>{fill(ui.autoConvert.shareValue, { pct: 10 })}</span>
        <span>{fill(ui.autoConvert.shareValue, { pct: 100 })}</span>
      </div>
      {hasSales(ctx) && (
        <div className="mt-6 border-t border-line-100 pt-2">
          <Switch
            label={ui.autoConvert.salesOnly}
            hint={ui.autoConvert.salesOnlyHint}
            on={d.onlyOnDaysWithSales}
            onChange={(onlyOnDaysWithSales) => api.set({ onlyOnDaysWithSales })}
            testId="sales-only-switch"
          />
        </div>
      )}
    </div>
  )
}

function ReviewBody({ d, ctx, api }: StepProps<Draft>) {
  const after = afterOf(d, ctx)
  const bank = bankOf(ctx.content, ctx.persona)
  const tz = ctx.app.persona(ctx.persona)?.tz ?? ctx.content.config.t0.tz
  const edit = (step: string) => () => api.goto(step, { editing: true })
  if (!after) return null
  const preview = d.enabled ? autoConvertPreview(ctx.state, ctx.persona, after, ctx.now, tz) : null
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3.5 font-display text-display-m text-navy-900">{ui.autoConvert.reviewTitle}</h2>
      <FactsCard
        accent
        facts={
          d.enabled
            ? [
                {
                  label: ui.autoConvert.rowSchedule,
                  value: scheduleLine(after),
                  onEdit: edit('schedule'),
                  testId: 'fact-schedule',
                },
                {
                  label: ui.autoConvert.rowShare,
                  value: fill(ui.autoConvert.shareLine, { pct: after.sharePct }),
                  onEdit: edit('share'),
                  testId: 'fact-share',
                },
                ...(hasSales(ctx)
                  ? [
                      {
                        label: ui.autoConvert.rowSalesOnly,
                        value: after.onlyOnDaysWithSales ? ui.autoConvert.on : ui.autoConvert.off,
                        onEdit: edit('share'),
                        testId: 'fact-sales-only',
                      },
                    ]
                  : []),
                { label: ui.autoConvert.rowConversion, value: ui.autoConvert.included, testId: 'fact-conversion' },
                ...(bank ? [{ label: ui.autoConvert.rowTo, value: bank, mono: true, testId: 'fact-to' }] : []),
              ]
            : [
                {
                  label: ui.autoConvert.rowState,
                  value: ui.autoConvert.off,
                  onEdit: edit('onoff'),
                  testId: 'fact-state',
                },
              ]
        }
      />
      {preview ? (
        <p
          data-testid="auto-convert-next"
          className="mt-3.5 flex items-center gap-2.5 bg-green-50 px-3.5 py-3 font-body text-body-s font-semibold text-navy-900 tnum"
        >
          <Clock size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {fill(ui.autoConvert.next, {
            when: whenText(preview.at, ctx.now, tz),
            amount: formatMinor(preview.amount),
            eur: formatHundredths(preview.eur),
          })}
        </p>
      ) : (
        !d.enabled && <p className="mt-3 font-body text-body-s text-grey-600">{ui.autoConvert.offNote}</p>
      )}
    </div>
  )
}

export const autoConvertFlow: FlowImpl<Draft> = {
  id: 'autoConvert',
  title: () => ui.autoConvert.title,
  tone: () => 'business',
  barFromTwo: true,
  init: (ctx) => {
    const a = currentOf(ctx)
    return {
      enabled: a?.enabled ?? false,
      schedule: a?.schedule ?? 'daily',
      atLocal: a?.atLocal ?? '23:00',
      sharePct: a?.sharePct ?? 50,
      onlyOnDaysWithSales: a?.onlyOnDaysWithSales ?? false,
      saved: false,
    }
  },
  steps: [
    {
      id: 'onoff',
      screen: 'biz.autoconvert.onoff',
      kind: 'input',
      Screen: OnOffBody,
      primary: () => ({ label: ui.common.continue, tone: 'navy', enabled: true }),
    },
    {
      id: 'schedule',
      screen: 'biz.autoconvert.schedule',
      kind: 'input',
      Screen: ScheduleBody,
      skip: (d) => !d.enabled,
      primary: () => ({ label: ui.common.continue, tone: 'navy', enabled: true }),
    },
    {
      id: 'share',
      screen: 'biz.autoconvert.share',
      kind: 'input',
      Screen: ShareBody,
      skip: (d) => !d.enabled,
      primary: () => ({ label: ui.common.continue, tone: 'navy', enabled: true }),
    },
    {
      id: 'review',
      screen: 'biz.autoconvert.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: () => ({ label: ui.autoConvert.save, tone: 'navy', enabled: true }),
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'none',
      command: (d, ctx, cmdId) => ({
        type: 'merchant.settings',
        actor: ctx.persona,
        cmdId,
        patch: { autoConvert: patchOf(d, ctx) },
      }),
      onAccepted: (_d, _ctx, api) => api.set({ saved: true }),
    },
  ],
  done: (d) => d.saved,
  Success: ({ ctx, done }) => {
    const now = currentOf(ctx)
    return (
      <SuccessScreen
        id="biz.autoconvert.saved"
        variant="neutral"
        overline={ui.autoConvert.savedOverline}
        title={ui.autoConvert.savedTitle}
        body={now ? stripText(now) : undefined}
        onDone={done}
      />
    )
  },
}
