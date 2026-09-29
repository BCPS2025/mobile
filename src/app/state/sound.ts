// The short chime of Settings › Sound when a sale settles: two soft tones from the Web Audio
// oscillator (no files, no network). Any failure (no audio, blocked until a tap) is ignored.

type AudioGlobals = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }

let context: AudioContext | null = null

export function chime(): void {
  try {
    const g = globalThis as unknown as AudioGlobals
    const Ctx = g.AudioContext ?? g.webkitAudioContext
    if (!Ctx) return
    const ctx = context ?? new Ctx()
    context = ctx
    if (ctx.state === 'suspended') void ctx.resume()
    const start = ctx.currentTime
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start + i * 0.11)
      gain.gain.exponentialRampToValueAtTime(0.12, start + i * 0.11 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.11 + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start + i * 0.11)
      osc.stop(start + i * 0.11 + 0.25)
    }
  } catch {
    // Sound is a nicety: nothing to do.
  }
}
