import { describe, expect, it } from 'vitest'
import {
  BIOMETRIC_MS,
  CHIP_DELAY_MS,
  CHIP_DWELL_MS,
  CODE_DIGITS,
  DIGIT_MS,
  TYPE_CAP_MS,
  TYPE_CHAR_MS,
  VERIFY_MS,
  formatCode,
  typeInterval,
} from '@app/phone/auth/timing'
import { maskEmail } from '@app/format'
import { codeForLogin } from '@store/sessions'
import { freshUi } from '@store/record'
import { content } from './helpers'

// The login screens' timings (D19): 25 ms per typed character, never more than 600 ms in all; the
// chip after 700 ms, 80 ms per digit; a 400 ms spinner; 500 ms of biometrics.

describe('login timings', () => {
  it('types at 25 ms a character, and no slower than 600 ms in all', () => {
    expect(TYPE_CHAR_MS).toBe(25)
    expect(TYPE_CAP_MS).toBe(600)
    const email = maskEmail('marko.kovac@example.com')
    expect(email).toBe('marko.kovac@•••••••')
    expect(typeInterval(email.length) * email.length).toBeLessThanOrEqual(600)
    expect(typeInterval(email.length)).toBe(25)
    const long = 'a'.repeat(40)
    expect(typeInterval(long.length)).toBe(15)
    expect(typeInterval(long.length) * long.length).toBe(600)
  })

  it('the chip comes after 700 ms and fills six digits at 80 ms each; verifying takes 400 ms, biometrics 500 ms', () => {
    expect(CHIP_DELAY_MS).toBe(700)
    expect(DIGIT_MS).toBe(80)
    expect(CODE_DIGITS).toBe(6)
    expect(CHIP_DELAY_MS + CHIP_DWELL_MS + CODE_DIGITS * DIGIT_MS).toBeLessThan(2000)
    expect(VERIFY_MS).toBe(400)
    expect(BIOMETRIC_MS).toBe(500)
  })

  it('shows the code in two groups of three', () => {
    expect(formatCode('482916')).toBe('482 916')
    expect(formatCode('000042')).toBe('000 042')
  })

  it('the first login after Reset shows the seed code of every live account; the next one another', () => {
    const ui = freshUi()
    const codes = Object.fromEntries(
      content.personas.personas.filter((p) => p.login).map((p) => [p.id, p.login?.code as string]),
    )
    expect(codeForLogin(ui, 'ana', codes.ana as string)).toBe('482916')
    expect(codeForLogin(ui, 'cafe', codes.cafe as string)).toBe('264903')
    expect(codeForLogin(ui, 'ana', codes.ana as string, 1)).not.toBe('482916')
  })
})
