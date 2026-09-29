// The timings of the login screens (all real time, never the virtual clock): the email types
// itself at 25 ms per character but never longer than 600 ms in all; the mail chip slides up 700 ms
// after the code screen opens and fills the six boxes at 80 ms per digit; verifying spins for
// 400 ms; the biometrics glyph shows for 500 ms.

export const TYPE_CHAR_MS = 25
export const TYPE_CAP_MS = 600
export const CHIP_DELAY_MS = 700
/** How long the chip is on screen before it fills the boxes. */
export const CHIP_DWELL_MS = 350
export const DIGIT_MS = 80
export const VERIFY_MS = 400
export const BIOMETRIC_MS = 500
export const CODE_DIGITS = 6

/** Milliseconds between two typed characters of a text `length` characters long. */
export function typeInterval(length: number): number {
  return length <= 0 ? TYPE_CHAR_MS : Math.min(TYPE_CHAR_MS, TYPE_CAP_MS / length)
}

/** "482916" -> "482 916" (the chip). */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`
}
