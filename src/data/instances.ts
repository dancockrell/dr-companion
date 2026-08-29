/**
 * The four DragonRealms instances, and the port Lich opens for each.
 *
 * Values from the Genie 4 wiki, "Connecting and Profiles". This lived inside
 * ConnectGuide, which is the right place to *teach* it and the wrong place to
 * *keep* it: the attach control in GamePane needs the same table to say which
 * game a port belongs to, and a second copy of four port numbers is a second
 * thing to forget to update.
 *
 * Why GamePane needs it at all. The attach port is remembered between runs,
 * and a value stored during fixture testing is indistinguishable from a real
 * one — GamePane's own note says a `v1` key "got stuck on 11124 on this
 * machine for exactly that reason". The fix there was to stop guessing which
 * stored values are safe, which is right, and it leaves the player looking at
 * a bare five-digit number with nothing to check it against. Measured on the
 * real app: the pane read `--detachable-client=11124` while the character was
 * on Prime, whose port is 11024. 11124 is Platinum.
 *
 * Naming the instance is knowledge this app legitimately has — it is in the
 * setup guide already — and it turns a number nobody can verify into one
 * anybody can. It says nothing about fixtures, which is the line GamePane's
 * note draws and this respects.
 */
import type { GameInstance } from '../types'

export interface InstanceConfig {
  id: GameInstance
  label: string
  port: number
  /** Genie's licharguments value, which includes --genie. */
  genieArgs: string
  /** The instance flags Lich itself needs, without the frontend flag. */
  lichArgs: string
  suffix: string
}

export const INSTANCES: InstanceConfig[] = [
  {
    id: 'Prime',
    label: 'Prime',
    port: 11024,
    genieArgs: '--genie --dragonrealms',
    lichArgs: '--dragonrealms',
    suffix: 'DR',
  },
  {
    id: 'Platinum',
    label: 'Platinum',
    port: 11124,
    genieArgs: '--genie --platinum --dragonrealms',
    lichArgs: '--platinum --dragonrealms',
    suffix: 'DRX',
  },
  {
    id: 'Fallen',
    label: 'The Fallen',
    port: 11324,
    genieArgs: '--genie --fallen',
    lichArgs: '--fallen',
    suffix: 'DRF',
  },
  {
    id: 'Test',
    label: 'Test',
    port: 11624,
    genieArgs: '--genie --test --dragonrealms',
    lichArgs: '--test --dragonrealms',
    suffix: 'DRT',
  },
]

/**
 * Which instance this port belongs to, or null for anything else.
 *
 * Null is the common and correct answer — a Lich somebody started by hand, a
 * second character on a second port. It deliberately does not guess: an
 * unrecognised port is unlabelled rather than labelled wrongly, because a
 * wrong label here would be worse than none.
 */
export function instanceForPort(port: number | string): InstanceConfig | null {
  const n = Number(port)
  return INSTANCES.find((i) => i.port === n) ?? null
}
