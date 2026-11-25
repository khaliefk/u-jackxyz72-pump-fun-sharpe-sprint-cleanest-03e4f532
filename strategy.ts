// Steady-hands momentum bot for the pump.fun Sharpe sprint.
//
// Most pump.fun curves bleed out; only a few sprint. This bot buys a
// sprint that is already underway — several distinct wallets buying, net
// SOL flowing in, price climbing but not yet vertical — bets small against
// a 10 SOL bankroll, and gets out fast: a modest take-profit, a tight
// stop, a trailing stop once a trade is green, and a hard time limit so
// dead money never sits. Small repeatable wins with capped losses are
// what an hourly Sharpe ratio rewards, not a single moonshot.
//
// Guardrail insurance: when the bot's own round trips lag, it runs tiny
// probe trades (0.02 SOL) on the most active liquid curve and exits them
// quickly, so the 20-distinct-mints bar is met even in a quiet window.
//
// Deterministic by construction: no clock, no environment reads, no
// Math.random; every loop walks insertion-ordered maps fed by the batch
// stream, so two runs produce byte-identical action logs.

import type {
  Batch,
  BotState,
  OrderInput,
  Pubkey,
} from "./vendor/makefun-bot.ts";
import { LAMPORTS_PER_SOL } from "./vendor/makefun-bot.ts";

const SOL_LAMPORTS = 1e9; // lamports per SOL, as a number for tape math

export interface BotParams {
  // sizing
  stakeSol: number;
  minBuySol: number;
  buySlipBps: number;
  // entry window
  window: number;
  minNetSol: number;
  minBuys: number;
  minBuyers: number;
  maxBuyerShare: number;
  minPriceUp: number;
  maxPriceUp: number;
  nearHigh: number;
  minRealSol: number;
  maxRealSol: number;
  minAgeSlots: number;
  maxEntries: number;
  cooldownSlots: number;
  // exits
  takeProfit: number;
  stopLoss: number;
  trailArm: number;
  trailGiveback: number;
  maxHoldSlots: number;
  // probes
  probeTargetCoins: number;
  probeMinRealSol: number;
}

export const DEFAULTS: BotParams = {
  stakeSol: 0.4,
  minBuySol: 0.02,
  buySlipBps: 300,
  window: 10,
  minNetSol: 1.0,
  minBuys: 9,
  minBuyers: 4,
  maxBuyerShare: 0.5,
  minPriceUp: 0.02,
  maxPriceUp: 0.35,
  nearHigh: 0.97,
  minRealSol: 1,
  maxRealSol: 80,
  minAgeSlots: 30,
  maxEntries: 2,
  cooldownSlots: 500,
  takeProfit: 1.07,
  stopLoss: 0.92,
  trailArm: 1.1,
  trailGiveback: 0.9,
  maxHoldSlots: 400,
  probeTargetCoins: 30,
  probeMinRealSol: 5,
};

const MAX_TAPE = 40;
const STALE_AFTER_SLOTS = 30_000;
const PROBE_TP = 1.04;
const PROBE_SL = 0.96;
const PROBE_MAX_HOLD = 800;

interface TapeEntry {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface CurveTape {
  createdSlot: number;
  trades: TapeEntry[];
  entries: number;
  cooldownUntil: number;
  lastSeenSlot: number;
}

interface Position {
  cost: bigint;
  tokens: bigint;
  entrySlot: number;
  peakRatio: number; // best value / cost seen
  probe: boolean;
}

function quotePrice(state: BotState, mint: Pubkey, tape: CurveTape | undefined): number {
  const curve = state.curves.get(mint);
  if (curve !== undefined && curve.virtual_token_reserves > 0n) {
    return Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
  }
  const trades = tape?.trades;
  if (trades !== undefined && trades.length > 0) return trades[trades.length - 1].price;
  return 0;
}

function toSol(n: bigint): number {
  return Number(n) / SOL_LAMPORTS;
}

export function createSharpeBot(overrides: Partial<BotParams> = {}): {
  onBatch(state: BotState, batch: Batch): OrderInput[];
} {
  const p: BotParams = { ...DEFAULTS, ...overrides };
  const stakeLamports = BigInt(Math.round(p.stakeSol * SOL_LAMPORTS));
  const minBuyLamports = BigInt(Math.round(p.minBuySol * SOL_LAMPORTS));

  const tapes = new Map<Pubkey, CurveTape>();
  const held = new Map<Pubkey, Position>();
  /** Mints with a filled buy of at least minBuySol. */
  const bought = new Set<Pubkey>();
  /** Mints with a completed round trip (buy then sell, both filled). */
  const roundTripped = new Set<Pubkey>();
  /** One probe at a time, by mint. */
  const probes = new Set<Pubkey>();

  function getTape(mint: Pubkey, slot: number): CurveTape {
    let tape = tapes.get(mint);
    if (tape === undefined) {
      tape = {
        createdSlot: slot,
        trades: [],
        entries: 0,
        cooldownUntil: 0,
        lastSeenSlot: slot,
      };
      tapes.set(mint, tape);
    }
    return tape;
  }

  function applyFills(state: BotState, batch: Batch): void {
    for (const fill of batch.fills) {
      if (fill.status !== "filled") {
        // A probe buy that never filled frees the single-probe slot.
        if (fill.side === "buy") probes.delete(fill.mint);
        continue;
      }
      const mint = fill.mint;
      if (fill.side === "buy") {
        const quote = BigInt(fill.quote_lamports);
        if (quote >= minBuyLamports) bought.add(mint);
        const prev = held.get(mint);
        if (prev !== undefined) {
          prev.cost += quote;
          prev.tokens += BigInt(fill.token_amount);
        } else {
          held.set(mint, {
            cost: quote,
            tokens: BigInt(fill.token_amount),
            entrySlot: fill.slot,
            peakRatio: 0,
            probe: probes.has(mint),
          });
        }
      } else {
        held.delete(mint);
        probes.delete(mint);
        if (bought.has(mint)) roundTripped.add(mint);
        const tape = tapes.get(mint);
        if (tape !== undefined) tape.cooldownUntil = state.slot + p.cooldownSlots;
      }
    }
  }

  function windowSummary(tape: CurveTape): {
    netSol: number;
    buys: number;
    buyers: Set<string>;
    buySol: number;
    maxBuyerSol: number;
    startPrice: number;
    highPrice: number;
  } | null {
    const trades = tape.trades;
    if (trades.length < p.window) return null;
    const win = trades.slice(trades.length - p.window);
    let netSol = 0;
    let buys = 0;
    let buySol = 0;
    const buyers = new Set<string>();
    const perBuyer = new Map<string, number>();
    let highPrice = 0;
    for (const t of win) {
      if (t.buy) {
        buys += 1;
        buySol += t.sol;
        netSol += t.sol;
        buyers.add(t.user);
        perBuyer.set(t.user, (perBuyer.get(t.user) ?? 0) + t.sol);
      } else {
        netSol -= t.sol;
      }
      if (t.price > highPrice) highPrice = t.price;
    }
    let maxBuyerSol = 0;
    for (const v of perBuyer.values()) if (v > maxBuyerSol) maxBuyerSol = v;
    return { netSol, buys, buyers, buySol, maxBuyerSol, startPrice: win[0].price, highPrice };
  }

  // Net SOL of the newer half of the window: positive means the sprint
  // is still accelerating, not already rolled over.
  function newerHalfNet(tape: CurveTape): number {
    const win = tape.trades.slice(tape.trades.length - p.window);
    const half = Math.floor(p.window / 2);
    let net = 0;
    for (let i = half; i < win.length; i += 1) net += win[i].buy ? win[i].sol : -win[i].sol;
    return net;
  }

  function shouldEnter(state: BotState, mint: Pubkey, tape: CurveTape): boolean {
    if (tape.entries >= p.maxEntries) return false;
    if (state.slot < tape.cooldownUntil) return false;
    if (state.slot - tape.createdSlot < p.minAgeSlots) return false;
    const curve = state.curves.get(mint);
    if (curve === undefined || curve.complete) return false;
    const realSol = toSol(curve.real_quote_reserves);
    if (realSol < p.minRealSol || realSol > p.maxRealSol) return false;
    const s = windowSummary(tape);
    if (s === null) return false;
    if (s.netSol < p.minNetSol) return false;
    if (s.buys < p.minBuys) return false;
    if (s.buyers.size < p.minBuyers) return false;
    if (s.buySol > 0 && s.maxBuyerSol / s.buySol > p.maxBuyerShare) return false;
    const price = quotePrice(state, mint, tape);
    if (price <= 0 || s.startPrice <= 0) return false;
    const up = price / s.startPrice - 1;
    if (up < p.minPriceUp || up > p.maxPriceUp) return false;
    if (s.highPrice > 0 && price < p.nearHigh * s.highPrice) return false;
    // Acceleration: the newer half of the window must still be buying.
    if (newerHalfNet(tape) <= 0) return false;
    return true;
  }

  function exitWhy(state: BotState, mint: Pubkey, h: Position, tape: CurveTape | undefined): string | null {
    const price = quotePrice(state, mint, tape);
    if (price <= 0 || h.cost <= 0n || h.tokens <= 0n) return "no-price";
    const valueSol = toSol(h.tokens) * price;
    const costSol = toSol(h.cost);
    const ratio = valueSol / costSol;
    if (ratio > h.peakRatio) h.peakRatio = ratio;
    if (ratio >= p.takeProfit) return "take-profit";
    if (ratio <= p.stopLoss) return "stop-loss";
    if (h.peakRatio >= p.trailArm && ratio <= p.trailGiveback * h.peakRatio) return "trailing-stop";
    if (state.slot - h.entrySlot >= p.maxHoldSlots) return "time-limit";
    if (h.probe) {
      if (ratio >= PROBE_TP) return "probe-take";
      if (ratio <= PROBE_SL) return "probe-stop";
      if (state.slot - h.entrySlot >= PROBE_MAX_HOLD) return "probe-time";
    }
    return null;
  }

  function chooseProbe(state: BotState): Pubkey | null {
    let best: Pubkey | null = null;
    let bestTrades = 0;
    for (const [mint, tape] of tapes) {
      if (held.has(mint) || bought.has(mint)) continue;
      if (state.slot < tape.cooldownUntil) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (toSol(curve.real_quote_reserves) < p.probeMinRealSol) continue;
      if (tape.trades.length < p.window) continue;
      // Probe only when the newer half of the window is still buying:
      // a busy tape that has already rolled over is not a fresh sprint.
      if (newerHalfNet(tape) <= 0) continue;
      if (tape.trades.length > bestTrades) {
        bestTrades = tape.trades.length;
        best = mint;
      }
    }
    return best;
  }

  function sweepStale(state: BotState): void {
    for (const [mint, tape] of tapes) {
      if (held.has(mint)) continue;
      if (state.slot - tape.lastSeenSlot < STALE_AFTER_SLOTS) continue;
      tapes.delete(mint);
    }
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      applyFills(state, batch);

      // Fold this batch's events into the tapes.
      for (const e of batch.events) {
        if (e.event === "CreateEvent") {
          const tape = getTape(e.mint, e.slot);
          tape.createdSlot = e.slot;
          tape.lastSeenSlot = e.slot;
        } else if (e.event === "TradeEvent") {
          const tape = getTape(e.mint, e.slot);
          const price =
            Number(BigInt(e.virtual_quote_reserves)) / Number(BigInt(e.virtual_token_reserves));
          tape.trades.push({
            slot: e.slot,
            buy: e.is_buy,
            sol: toSol(BigInt(e.sol_amount)),
            user: e.user,
            price,
          });
          if (tape.trades.length > MAX_TAPE) tape.trades.splice(0, tape.trades.length - MAX_TAPE);
          tape.lastSeenSlot = e.slot;
        } else {
          const tape = tapes.get(e.mint);
          if (tape !== undefined) tape.lastSeenSlot = e.slot;
        }
      }

      if (batch.seq % 1000 === 0) sweepStale(state);

      const orders: OrderInput[] = [];
      const maxOrders = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      let free = state.freeCashLamports();

      // 1. Exits first: every held position whose exit fired sells whole.
      for (const [mint, h] of held) {
        if (orders.length >= maxOrders) break;
        const pos = state.positions.get(mint);
        if (pos === undefined || pos.token_amount <= 0n) continue;
        if ([...state.pending.values()].some((q) => q.order.mint === mint && q.order.side === "sell")) continue;
        const reason = exitWhy(state, mint, h, tapes.get(mint));
        if (reason === null) continue;
        orders.push({ side: "sell", mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        free -= tx;
      }

      // 2. Momentum entries: mints that traded in this batch and show a sprint.
      let slots = state.hello.caps.max_open_positions - state.committedPositionCount();
      for (const e of batch.events) {
        if (orders.length >= maxOrders || slots <= 0) break;
        if (e.event !== "TradeEvent") continue;
        const mint = e.mint;
        if (held.has(mint)) continue;
        const tape = tapes.get(mint);
        if (tape === undefined) continue;
        if (!shouldEnter(state, mint, tape)) continue;
        const cap = state.maxBuyLamports(mint);
        if (cap < minBuyLamports) continue;
        const amount = cap < stakeLamports ? cap : stakeLamports;
        if (free < amount + tx) continue;
        orders.push({ side: "buy", mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
        tape.entries += 1;
        free -= amount + tx;
        slots -= 1;
      }

      // 3. Guardrail probe: one small round trip on the busiest liquid curve
      // while distinct-mint round trips are short of target.
      if (
        orders.length < maxOrders &&
        slots > 0 &&
        roundTripped.size < p.probeTargetCoins &&
        probes.size === 0 &&
        [...held.values()].every((h) => !h.probe)
      ) {
        const mint = chooseProbe(state);
        if (mint !== null) {
          const cap = state.maxBuyLamports(mint);
          if (cap >= minBuyLamports && free >= minBuyLamports + tx) {
            orders.push({ side: "buy", mint, quote_lamports: minBuyLamports, max_slippage_bps: p.buySlipBps });
            probes.add(mint);
          }
        }
      }

      return orders;
    },
  };
}
