# Gated Dual-Dip — cbBTC trading bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/xantuyz/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/xantuyz/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Gated dual-dip mean-reversion bot for cbBTC. Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $250 in USDC.

## Strategy

Buy BTC dips, but only when the dip is real:

- **Deep dip (always on):** buy 100% of cash when the close is 2% under the 240-minute SMA. Take-profit +0.5% — in a waterfall you must exit fast.
- **Shallow dip (regime-gated):** buy 100% of cash when the close is 0.8% under the 60-minute SMA **and** the 60-minute mean is at or above the 240-minute mean (the short trend is not down). Take-profit +1.5%.
- **Stop-loss:** −2% under the cost basis.
- **Fallback:** if the bot has never held a position by bar 1080 (6 hours left), it buys at the close anyway, so the ≥1-trade guardrail holds even in a window flatter than any seen so far.

All arithmetic is integer `bigint` on the harness's raw units — no floats, no clock, no randomness — so the two graded runs are byte-identical. The entry price uses the manifest scales (`qty_scale + price_scale − quote_scale = 8 + 5 − 6 = 7`); CBBTC's `price_scale` is 5, not 8.

## Why this shape

The previous race's bot bought 2% under the 240-minute SMA only. On its own dev window (−4% in 24h) it made +12.12 USDC, but on the next window (sideways, +0.5%) it fired **zero times in 24 hours** and took no prize. Shallow dip-buying alone wins on the sideways window (+23.75 USDC) but loses −50 USDC or worse on the falling window. The regime gate is the fix: this hybrid is positive on **both** published 24h windows — +28.99 USDC on the sideways window, +17.78 USDC on the falling window — with max drawdown under 1.5% on either.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout) via the vendored `vendor/makefun-bars.ts` shim. Grade it locally with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo> --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=b4rk0bn2&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
