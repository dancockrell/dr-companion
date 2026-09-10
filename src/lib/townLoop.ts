/**
 * Money and town-transaction types for the town half of the session loop —
 * selling, pawning, repair, banking and cross-province exchange.
 * See docs/DOMAIN.md section 10 for what a real town run covers, and
 * `docs/PLAN_TO_1_0.md` Lane X for the increments that consume this file.
 *
 * This file is the data model only. Nothing here talks to the bridge (Lane
 * X1's job) and nothing here reads a shop or merchant database, because
 * there is not one: measured, `data/elanthipedia/` has 11 files covering
 * items, weapons, armor, creatures and materials, and deliberately nothing
 * about merchants. The merchant knowledge a player needs already lives in
 * their own dr-scripts `base-town.yaml` (DOMAIN.md section 11) — reading
 * that file, not rebuilding it, is Lane X2's job.
 */

import type { Province } from '../data/obstacles.ts'

/**
 * DOMAIN.md:148, parsed from a community fine-parsing routine and consistent
 * with the F2P bank cap (`accountCapabilities.ts`'s `bankCapPlatinum`):
 *
 *   1 platinum = 10 gold = 100 silver = 1,000 bronze = 10,000 copper
 *
 * Ordered richest to poorest — the order a bank teller counts change in, and
 * the order `fromCopper` below fills denominations in.
 */
export type Denomination = 'platinum' | 'gold' | 'silver' | 'bronze' | 'copper'

export const DENOMINATIONS: readonly Denomination[] = [
  'platinum',
  'gold',
  'silver',
  'bronze',
  'copper',
]

/**
 * Value of one coin of each denomination, in copper — copper is the base
 * unit because every other denomination is a whole multiple of it, which
 * makes integer copper the safe accumulator for totals and comparisons.
 * A wrong number here is a silent factor of ten, so it is asserted against
 * `DOMAIN.md:148` by `tools/townLoop-test.mjs`, not just typed once and
 * trusted.
 */
export const COPPER_PER_DENOMINATION: Readonly<Record<Denomination, number>> = {
  platinum: 10_000,
  gold: 1_000,
  silver: 100,
  bronze: 10,
  copper: 1,
}

/**
 * A count of coins by denomination. Any subset is valid; an absent key
 * means zero of that denomination, the same "absence is a fact" convention
 * `CharacterStatus` documents elsewhere in this codebase.
 */
export type CoinCount = Partial<Record<Denomination, number>>

/**
 * Sum a coin count to its value in copper.
 *
 * Throws rather than returning a wrong number for a negative or non-finite
 * count — a coin count is a physical inventory, and "-3 platinum" is not a
 * value this domain has, it is a caller bug.
 */
export function toCopper(coins: CoinCount): number {
  let total = 0
  for (const denomination of DENOMINATIONS) {
    const count = coins[denomination]
    if (count == null) continue
    if (!Number.isFinite(count) || count < 0) {
      throw new RangeError(
        `toCopper: ${denomination} count must be a non-negative finite number, got ${count}`
      )
    }
    total += count * COPPER_PER_DENOMINATION[denomination]
  }
  return total
}

/**
 * Break a copper total into the fewest coins of each denomination, richest
 * first — the shape a bank teller hands back, and the normalized form
 * `toCopper` and `fromCopper` round-trip through.
 */
export function fromCopper(totalCopper: number): Record<Denomination, number> {
  if (!Number.isFinite(totalCopper) || totalCopper < 0 || !Number.isInteger(totalCopper)) {
    throw new RangeError(
      `fromCopper: expected a non-negative integer copper total, got ${totalCopper}`
    )
  }
  const out = {} as Record<Denomination, number>
  let remaining = totalCopper
  for (const denomination of DENOMINATIONS) {
    const unit = COPPER_PER_DENOMINATION[denomination]
    out[denomination] = Math.floor(remaining / unit)
    remaining -= out[denomination] * unit
  }
  return out
}

/**
 * Convert a quantity of one denomination into another. Fractional results
 * are real and expected — 1 silver in platinum is 0.01 — this is a unit
 * conversion, not a coin count, so the caller decides whether to round.
 */
export function convertDenomination(
  amount: number,
  from: Denomination,
  to: Denomination
): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`convertDenomination: amount must be finite, got ${amount}`)
  }
  return (amount * COPPER_PER_DENOMINATION[from]) / COPPER_PER_DENOMINATION[to]
}

/**
 * What a character has, split the way the game actually splits it.
 *
 * Coins on hand are carried on the character's person — DragonRealms has one
 * currency, so a purse is not province-scoped. Coins banked are on deposit
 * at a specific province's bank, and a DragonRealms bank balance does not
 * follow the character across a province line: moving value between
 * province banks is a real, separate step (`base-town.yaml`'s "money
 * exchange", Lane X3), not a bookkeeping nicety. So `banked` is keyed by
 * province from the start, even though nothing reads or writes more than
 * one entry in it yet — that is what lets X3 add cross-province exchange
 * without reshaping this type.
 */
export interface Wealth {
  onHand: CoinCount
  /** Present only for provinces the character has actually banked in. */
  banked: Partial<Record<Province, CoinCount>>
}

/** An empty wealth snapshot — the starting point before any bridge reads it. */
export function emptyWealth(): Wealth {
  return { onHand: {}, banked: {} }
}

/**
 * What a town transaction (sell, pawn, repair, deposit, withdraw, exchange)
 * actually did. Shared by Lane X2 (selling/pawning/repair) and Lane X3
 * (banking/exchange) so both report success, refusal and the coins involved
 * the same way, rather than inventing their own shape each.
 */
export type TownTransactionKind =
  | 'sell'
  | 'pawn'
  | 'repair'
  | 'deposit'
  | 'withdraw'
  | 'exchange'

export interface TownTransactionResult {
  kind: TownTransactionKind
  /**
   * False for a sale, pawn or repair the game refused. A refusal must never
   * be reported as a completed transaction with zero coins — that is the
   * exact failure X2's own `verify:` line calls out.
   */
  ok: boolean
  /** Coins gained (sell/pawn/withdraw) or spent (repair/deposit), when known. */
  amount?: CoinCount
  /** The game's own text describing what happened. */
  description: string
  /** Present when `ok` is false: why the game refused. */
  reason?: string
}

/**
 * A cross-province exchange quote. X3's own `verify:` line: "an exchange
 * states its rate and its fee before it happens" — this is that statement's
 * shape, not an implementation of it.
 */
export interface ExchangeQuote {
  from: Province
  to: Province
  amount: CoinCount
  /** Units of `to` currency received per unit of `from` currency given up. */
  rate: number
  /** Taken by the exchange, on top of the rate. */
  fee: CoinCount
}
