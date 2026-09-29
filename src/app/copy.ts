import { content } from '@content/load'
import type { UiCopy } from '@content/copy-schema'
import { fillTemplate } from '@domain/counter'

// Typed access to content/copy.en.yaml. Both the engine and the interface sections were
// validated at build time (src/content/copy-schema.ts), so nothing is parsed here.

export type { UiCopy }

/** Interface copy (validated at build time). */
export const ui: UiCopy = content.copy

/** Engine copy sections (tape, fee and PAID lines, errors, seed rows). */
export const copy = content.copy

/** Fill {placeholders}. */
export const fill = fillTemplate
