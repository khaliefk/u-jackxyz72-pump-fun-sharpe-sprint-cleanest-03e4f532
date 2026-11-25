[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/khaliefk/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/khaliefk/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# Steady-Hands Momentum Bot

A paper-trading bot for the [Pump.fun Sharpe Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) on make.fun — a 6-hour pump.fun replay scored by hourly Sharpe ratio, where steady wins beat one lucky moonshot.

## Idea

Most pump.fun curves bleed out and only a few sprint. This bot waits for a sprint that is already underway, then rides it briefly:

- at least 4 distinct buyers and 9 buys in the last 10 trades, with net SOL above 1.0 and the newer half of the window still buying;
- price up 2–35% from the window start and holding near the window high, so it never chases a vertical move;
- no single buyer taking more than half of the buy volume, and real SOL reserves between 1 and 80.

It exits fast: +7% take-profit, −8% stop-loss, a trailing stop once a trade is 10% green, and a hard 400-slot time limit. Each bet is 0.4 SOL, at most 5 positions open at once.

## Guardrails

- 20 distinct mints with round trips of at least 0.01 SOL: when the bot's own round trips fall short, it sends tiny 0.02 SOL probe trades on the busiest liquid curve whose newer tape half is still buying, and exits them quickly.
- Drawdown stays far below the 50% cap thanks to the tight stops and small stakes.
- Fully deterministic — no clock, no environment reads, no randomness — so two runs produce byte-identical action logs.

## Files

- `main.ts` — entry point, run by the grader as `node /bot/main.ts`
- `strategy.ts` — entry filters, exits, and probes
- `vendor/makefun-bot.ts` — the kit's replay shim, vendored byte-identical

## License

MIT. Paper trading only; no real funds involved.
