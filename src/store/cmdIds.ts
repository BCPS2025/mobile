// Command ids: each flow instance gets 64 random bits; each commit point
// dispatches with `${instanceId}:${stepId}`. No counters, so ids never collide across the two
// phones or across reloads. Randomness lives here in the store layer, never in the domain.

export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

const defaultFill: RandomFill = (bytes) => crypto.getRandomValues(bytes)

/** 16 lower-case hex characters (64 bits). */
export function newFlowInstanceId(fill: RandomFill = defaultFill): string {
  const bytes = fill(new Uint8Array(8))
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export const CMD_ID = /^[0-9a-f]{16}:[a-z][a-z0-9-]{0,31}$/

export function cmdIdFor(instanceId: string, stepId: string): string {
  const id = `${instanceId}:${stepId}`
  if (!CMD_ID.test(id)) throw new Error(`bad command id ${id}`)
  return id
}
