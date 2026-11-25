// Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins.
// Entry point: the grader runs `node /bot/main.ts` (Node 22 strips types).
// The strategy lives in strategy.ts; the wire shim is vendored unchanged.

import { runBot } from './vendor/makefun-bot.ts';
import { createSharpeBot } from './strategy.ts';

await runBot(createSharpeBot());
