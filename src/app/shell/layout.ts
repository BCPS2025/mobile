// The stage's arithmetic: how big the two phones are drawn for a window, where the role labels
// and the toasts go. Pure, so the numbers are tested without a browser.

export const PHONE_W = 390
export const PHONE_H = 700

/** Top bar of the stage. */
export const TOPBAR_H = 44
/** Tape row, and the session counter under it (reserved whenever the tape is on, so the phones
 *  never change size when the first merchant payment arrives). */
export const TAPE_H = 26
export const COUNTER_H = 22
/** Space above the phones. */
const TOP_PAD = 4
/** The row with the label block and its buttons when the labels sit above the phones. */
export const LABEL_ROW_H = 48
/** The ⇄ button between the phones. */
export const SWAP_W = 44
/** The label block beside a phone (at 1,280 px and wider). */
export const LABEL_COL_W = 176
/** Breakpoint for labels beside the phones. */
export const SIDE_LABELS_FROM = 1280
/** Zoomed, the label stands beside the phone from this width. */
export const ZOOM_SIDE_LABELS_FROM = 900
/** Narrowest toast the gutter still takes; below this toasts move into the top bar. */
export const MIN_TOAST_W = 120

export interface StageLayout {
  /** Scale of a 390 × 700 phone. */
  scale: number
  labels: 'side' | 'above'
  /** Where toasts stand: the outer gutter beside a phone, or the top bar row. */
  toasts: 'gutter' | 'bar'
  /** Width of the gutter beside a phone (0 when zoomed). */
  gutter: number
  /** The drawn size of one phone. */
  width: number
  height: number
}

export interface StageLayoutOptions {
  tape: boolean
  /** One phone, fitted to the window height. */
  zoomed: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Scale of the phones for a window of w × h. Side by side they are limited by the height (top
 * bar, tape rows) and by the width (two phones, the swap button and, at 1,280 px and wider, the
 * label blocks beside them). Zoomed, one phone takes the whole height. At 1,280 × 720 with the
 * tape on the scale is 0.89.
 */
export function stageLayout(w: number, h: number, o: StageLayoutOptions): StageLayout {
  const bottom = o.tape ? TAPE_H + COUNTER_H : 0
  const side = w >= SIDE_LABELS_FROM
  if (o.zoomed) {
    // One phone takes the whole height (the tape steps aside); the label sits beside it when there is room.
    const beside = w >= ZOOM_SIDE_LABELS_FROM
    const scale = clamp((h - TOPBAR_H - TOP_PAD - 8 - (beside ? 0 : LABEL_ROW_H)) / PHONE_H, 0.5, 1.6)
    const width = PHONE_W * scale
    const gutter = (w - width) / 2
    return {
      scale,
      labels: beside ? 'side' : 'above',
      toasts: gutter >= MIN_TOAST_W ? 'gutter' : 'bar',
      gutter,
      width,
      height: PHONE_H * scale,
    }
  }
  const byHeight = (h - TOPBAR_H - bottom - TOP_PAD - (side ? 0 : LABEL_ROW_H)) / PHONE_H
  const across = side ? w - 2 * LABEL_COL_W - SWAP_W - 24 : w - SWAP_W - 32
  const byWidth = across / (2 * PHONE_W)
  const scale = clamp(Math.min(byHeight, byWidth, 1), 0.5, 1)
  const width = PHONE_W * scale
  const gutter = (w - 2 * width - SWAP_W) / 2
  return {
    scale,
    labels: side ? 'side' : 'above',
    toasts: gutter >= MIN_TOAST_W ? 'gutter' : 'bar',
    gutter,
    width,
    height: PHONE_H * scale,
  }
}
