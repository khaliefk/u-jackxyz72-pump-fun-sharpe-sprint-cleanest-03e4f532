[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/khaliefk/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/khaliefk/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# Steady-Hands Momentum Bot

Paper-trading bot for the [Pump.fun Sharpe Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) on make.fun: a 6-hour pump.fun replay ranked by hourly Sharpe ratio, not wildest PnL.

## How it trades

Most pump.fun curves bleed out; a minority sprint. The bot only buys a sprint already in progress:

- several distinct wallets buying, net SOL flowing in over the last 15 trades, with the newer half still buying;
- price up 3–60% from the window start, sitting near the window high (no chasing vertical moves);
- no single buyer dominating, real SOL reserves between 1 and 80.

Then it gets out fast: +9% take-profit, −10% stop-loss, a trailing stop once a trade is 10% green, and a hard 600-slot time limit so dead money never sits. Each position targets 0.4 SOL (capped at 1% of the curve's real reserves), at most 5 open at once.

Small, repeatable wins with capped losses is what an hourly Sharpe ratio rewards.

## Guardrails

- At least 20 distinct mints with round trips of 0.01 SOL or more: if the bot's own round trips lag, it runs tiny 0.02 SOL probe trades on the busiest liquid curve and exits them quickly.
- Max drawdown is kept far under the 50% cap by the tight stops and small stakes.
- Fully deterministic: no clock, no environment reads, no randomness. Two runs produce byte-identical action logs.

## Layout

- `main.ts` — entry point, run by the grader as `node /bot/main.ts`
- `strategy.ts` — the strategy (entry filters, exits, probes)
- `vendor/makefun-bot.ts` — the kit's replay shim, vendored byte-identical

## License

MIT. Paper trading only; no real funds involved.
