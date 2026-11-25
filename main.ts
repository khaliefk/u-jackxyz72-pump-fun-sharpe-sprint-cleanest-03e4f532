// Pump.fun Sharpe Sprint — cleanest paper bot wins.
// The grader starts here with `node /bot/main.ts` on Node 22, which strips
// types on the fly. All trading logic lives in strategy.ts; the replay
// shim under vendor/ is the kit's, byte-identical.

import { runBot } from "./vendor/makefun-bot.ts";
import { createSharpeBot } from "./strategy.ts";

const bot = createSharpeBot();
await runBot(bot);
