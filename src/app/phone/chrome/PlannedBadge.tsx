import { ui } from '../../copy'

/** PLANNED: the one honesty badge, a grey tag at the right of a row whose feature is not built. */
export function PlannedBadge() {
  return (
    <span className="shrink-0 bg-line-100 px-[7px] py-[3px] font-body text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-ink">
      {ui.common.planned}
    </span>
  )
}
