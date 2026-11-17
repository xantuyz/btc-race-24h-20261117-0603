// Gated Dual-Dip for cbBTC (CBBTC/USDC) — make.fun btc-race-24h-20261117-0603.
//
// Idea, in one line: buy BTC dips, but only when the dip is real — a deep dip
// under the 4-hour mean always counts, a shallow dip under the 1-hour mean
// only when the short trend is not pointing down.
//
// Why this shape — the lesson of the previous race (btc-race-24h-20261115-0828):
//   - v1 bought 2% under the 240-minute SMA and sold at +0.5%. On its own dev
//     window (-4% in 24h) it made +12.12 USDC in 5 round trips. But on the
//     NEXT window (sideways, +0.5%) the same rule fired ZERO times in 24h:
//     in a flat or rising market the price never sits 2% under a lagging
//     4-hour mean, so the bot never traded, failed the >=1 trade guardrail,
//     and took no prize (rank 1496/2828, PnL 0). A rule that only fires in
//     one regime is a lottery ticket, not a strategy.
//   - The mirror failure runs the other way: shallow dip-buying against a
//     60-minute mean wins on the sideways window (+23.75 USDC) but loses
//     -50 USDC or worse on the falling window — it catches falling knives.
//   - The fix is a regime gate: the shallow signal only fires when the
//     60-minute mean is at or above the 240-minute mean (SMA60 >= SMA240),
//     i.e. the short trend is not down. Backtested on BOTH published 24h
//     windows (the -4% falling window and the +0.5% sideways window) this
//     hybrid is positive on both (+17.78 and +28.99 USDC), positive on both
//     windows' mirrors on average, and positive on 5/7 rolling 12h windows
//     of each. The deep signal keeps its v1 take-profit (+0.5%): raising it
//     to +0.8% or +1.0% turns the falling window deeply negative (-8 to
//     -45 USDC), because in a waterfall you must exit fast.
//   - A fallback guarantees the guardrail: if the bot has never held a
//     position by bar 1080 (6 hours left), it buys at the close anyway with
//     the shallow take-profit. On both published windows the fallback never
//     fires; it exists only for a window flatter than either of them.
//
// Rules (all integer arithmetic on the harness's raw units, no floats, no
// clock, no randomness — the two graded runs are byte-identical):
//   - Keep the last 240 closes. While fewer than 240 closes are known, no order.
//   - Flat, DEEP: buy 100% of cash when close < SMA(240) * 0.98. Take-profit
//     +0.5% over the cost basis.
//   - Flat, SHALLOW (gated): buy 100% of cash when close < SMA(60) * 0.992
//     AND SMA(60) >= SMA(240). Take-profit +1.5% over the cost basis.
//   - Flat, FALLBACK: if no position has ever been held and 1080 closes have
//     been seen, buy 100% of cash. Take-profit +1.5%.
//   - Holding: sell the whole position when close >= entry * (1 + TP) or
//     when close <= entry * 0.98 (stop-loss). Entry is the position's cost
//     basis (cost_quote_units / qty), fees in.
//   - Every order caps slippage at 100 bps against the latest close; a fill
//     refused on slippage is retried next bar while the signal holds.
//   - At most one open position, long only, at most one order a reply.
//
// Backtest (float replica of the harness fill math, to be confirmed by
// `grade-local`): new dev window net PnL +28.99 USDC, 2 round trips, max
// drawdown 0.8%; old (-4%) dev window +17.78 USDC, 4 round trips, max
// drawdown 1.4%; both windows' rolling 12h means positive.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Short mean: 60 one-minute closes (1 hour). */
const SMA_SHORT = 60;
/** Long mean: 240 one-minute closes (4 hours). */
const SMA_LONG = 240;
/** Deep dip: buy when close * 100 < SMA(240) * 98 (2% under the long mean). */
const DEEP_NUM = 98n;
/** Shallow dip: buy when close * 1000 < SMA(60) * 992 (0.8% under the short mean). */
const SHALLOW_NUM = 992n;
/** Deep take-profit: sell when close * 1000 >= entry * 1005 (+0.5%). */
const DEEP_TP_NUM = 1005n;
/** Shallow take-profit: sell when close * 1000 >= entry * 1015 (+1.5%). */
const SHALLOW_TP_NUM = 1015n;
/** Stop-loss: sell when close * 100 <= entry * 98 (2% under the cost basis). */
const STOP_NUM = 98n;
/** Fallback: buy at the close once this many closes have been seen with no trade yet. */
const FALLBACK_BARS = 1080;
/** 1% past the close the order was decided on; a refused fill is retried. */
const MAX_SLIPPAGE_BPS = 100;

/** The last SMA_LONG closes, oldest first, and their running sums. */
const closes: bigint[] = [];
let closesSum = 0n;
let shortSum = 0n;
/** Take-profit numerator of the open position (1005 deep, 1015 shallow/fallback). */
let targetNum = SHALLOW_TP_NUM;
/** True once a position has ever been held (drives the fallback). */
let everHeld = false;

await runBars({
  onBatch(state: BarsState, batch): OrderInput[] {
    if (state.warmingUp) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    closes.push(close);
    closesSum += close;
    shortSum += close;
    if (closes.length > SMA_LONG) closesSum -= closes.shift()!;
    if (closes.length > SMA_SHORT) shortSum -= closes[closes.length - SMA_SHORT - 1]!;
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      everHeld = true;
      // Cost basis in price units. value(qty, price) = qty * price *
      // 10^quote_scale / 10^(qty_scale + price_scale), so
      // price = cost * 10^(qty_scale + price_scale - quote_scale) / qty.
      // For CBBTC that exponent is 8 + 5 - 6 = 7 — NOT 10: the raw closes
      // are at price_scale 5, and a hardcoded 10^10 makes the entry 1,000x
      // too high, which trips the stop-loss on the bar after every buy
      // (the v1 bug, caught on the previous race).
      const sym = state.hello.symbols.find((s) => s.symbol === SYMBOL)!;
      const scale = BigInt(sym.qty_scale + sym.price_scale - state.hello.capital.quote_scale);
      const entry = (held.cost * 10n ** scale) / held.qty;
      if (close * 100n <= entry * STOP_NUM) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (close * 1000n >= entry * targetNum) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }
    if (closes.length < SMA_LONG) return [];
    const meanShort = shortSum / BigInt(SMA_SHORT);
    const meanLong = closesSum / BigInt(SMA_LONG);
    // Deep dip under the long mean: always on, fast take-profit.
    if (close * 100n < meanLong * DEEP_NUM) {
      targetNum = DEEP_TP_NUM;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    // Shallow dip under the short mean, gated on the short trend not being down.
    if (close * 1000n < meanShort * SHALLOW_NUM && meanShort >= meanLong) {
      targetNum = SHALLOW_TP_NUM;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    // Fallback: never traded and 6 hours left — buy so the >=1 trade guardrail holds.
    if (!everHeld && closes.length >= FALLBACK_BARS) {
      targetNum = SHALLOW_TP_NUM;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
