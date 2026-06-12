/**
 * Eviction Notice — agent worker.
 *
 * A persistent, always-on Node daemon (Render Background Worker). The outer
 * heartbeat ticks forever: accrue rent → recompute balance → check alive →
 * think (inner reason-and-act loop) → sleep. When the ledger balance hits zero
 * the agent is EVICTED and the loop halts permanently — no revivals.
 */

import { computeVitals, isAlive } from 'shared';

import { runInnerTick } from './agent.ts';
import { cmcConfig, fetchQuotes } from './cmc.ts';
import { loadConfig } from './config.ts';
import { createAnthropicClient } from './llm.ts';
import { log } from './log.ts';
import { rentForInterval } from './rent.ts';
import {
  createClient,
  ensureBorn,
  fetchAgentState,
  fetchBalance,
  fetchOpenPositions,
  fetchSnapshots,
  fetchStatus,
  fetchTransactions,
  insertSnapshot,
  insertTransaction,
  lastTradeAtMs,
  markDead,
} from './supabase.ts';

// Load apps/worker/.env locally; in production the platform provides the env.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fall back to the ambient environment.
}

const config = loadConfig();
const client = createClient(config);
// The inner reason-and-act loop is optional: without an Anthropic key the
// heartbeat still accrues rent and tracks survival, it just doesn't think yet.
const llm = config.ANTHROPIC_API_KEY ? createAnthropicClient(config) : null;

let running = true;
let wake: (() => void) | null = null;

function requestStop(signal: string): void {
  log.warn('shutdown requested', { signal });
  running = false;
  wake?.();
}

process.on('SIGINT', () => {
  requestStop('SIGINT');
});
process.on('SIGTERM', () => {
  requestStop('SIGTERM');
});

/** Interruptible sleep — a stop signal wakes it early instead of waiting out the tick. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

/**
 * Per-tick marked balance sheet: cash (SUM ledger) + open positions marked to
 * current price = net worth. The dashboard can't mark positions itself, so the
 * worker records it. Marking uses an unmetered quote (no extra data burn); if it
 * fails or there's no CMC key, positions fall back to cost basis. Never throws —
 * a snapshot failure must not disturb the heartbeat.
 */
async function recordSnapshot(): Promise<number | null> {
  try {
    const cashUsd = await fetchBalance(client, config.AGENT_ID);
    const positions = await fetchOpenPositions(client, config.AGENT_ID);

    const marks = new Map<string, number>();
    if (positions.length > 0 && config.CMC_API_KEY) {
      try {
        const quotes = await fetchQuotes(
          cmcConfig(config),
          positions.map((p) => p.token),
        );
        for (const quote of quotes) {
          marks.set(quote.symbol.toUpperCase(), quote.priceUsd);
        }
      } catch (error: unknown) {
        log.warn('snapshot mark failed — using cost basis', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const marked = positions.map((p) => {
      const markPx = marks.get(p.token.toUpperCase()) ?? p.entryPx;
      return {
        token: p.token,
        sizeUsd: p.sizeUsd,
        entryPx: p.entryPx,
        markPx,
        valueUsd: p.sizeUsd * (markPx / p.entryPx),
      };
    });
    let positionValueUsd = 0;
    for (const m of marked) {
      positionValueUsd += m.valueUsd;
    }

    const netWorthUsd = cashUsd + positionValueUsd;
    await insertSnapshot(client, {
      agentId: config.AGENT_ID,
      cashUsd,
      positionValueUsd,
      netWorthUsd,
      positions: marked,
    });
    return netWorthUsd;
  } catch (error: unknown) {
    log.error('snapshot failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Gas-tank watch (live only): BNB is the agent's out-of-economy fuel — if it runs
 * dry, swaps fail. Warn so an operator can top it up. Best-effort; never throws.
 */
async function checkGasTank(): Promise<void> {
  if (config.EXECUTION_MODE !== 'live') return;
  try {
    const res = await fetch(config.BSC_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [config.X402_PAYER, 'latest'],
        id: 1,
      }),
    });
    const json: unknown = await res.json();
    const result =
      typeof json === 'object' && json !== null && 'result' in json
        ? (json as Record<string, unknown>)['result']
        : null;
    const bnb = typeof result === 'string' ? Number(BigInt(result)) / 1e18 : 0;
    if (bnb < config.MIN_BNB_GAS) {
      log.warn('low gas tank — top up BNB or live swaps will fail', {
        bnb,
        threshold: config.MIN_BNB_GAS,
        address: config.X402_PAYER,
      });
    }
  } catch (error: unknown) {
    log.warn('gas-tank check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  const { seeded } = await ensureBorn(client, config);
  const balance = await fetchBalance(client, config.AGENT_ID);
  log.info('worker online', {
    agentId: config.AGENT_ID,
    seeded,
    balance,
    rentPerHourUsd: config.RENT_PER_HOUR_USD,
    tickIntervalMs: config.TICK_INTERVAL_MS,
  });

  // Permadeath: a previously evicted agent is never resurrected.
  if ((await fetchStatus(client, config.AGENT_ID)) === 'dead') {
    log.warn('agent already evicted — halting (no revivals)');
    return;
  }

  let ticks = 0;
  while (running) {
    ticks += 1;
    const rent = rentForInterval(config.RENT_PER_HOUR_USD, config.TICK_INTERVAL_MS);
    await insertTransaction(client, {
      agentId: config.AGENT_ID,
      kind: 'rent',
      amount: -rent,
      reason: 'rent',
      reasoning: `Life-support rent @ $${config.RENT_PER_HOUR_USD.toFixed(2)}/h.`,
    });

    const balanceAfterRent = await fetchBalance(client, config.AGENT_ID);
    log.info('tick', { tick: ticks, rent: -rent, cash: balanceAfterRent });

    // Think: gather data, consult the sizing skill, decide. A failure here
    // (model/network) must not evict the agent — log and keep the heartbeat.
    if (llm) {
      try {
        // ≥1-trade/day floor: force a trade if none opened within the window.
        let mustTrade = false;
        if (config.TRADE_FLOOR_MS > 0) {
          const last = await lastTradeAtMs(client, config.AGENT_ID);
          mustTrade = last === null || Date.now() - last > config.TRADE_FLOOR_MS;
        }
        // Vitals on the SAME basis the dashboard shows: all-in burn (rent + data +
        // x402) and marked net worth (from snapshots). These drive the agent's
        // runway math and its desperation. Falls back to rent-only burn + cash.
        let burnRatePerHourUsd = config.RENT_PER_HOUR_USD;
        let netWorthUsd = balanceAfterRent;
        let peakNetWorthUsd = Math.max(balanceAfterRent, config.SEED_USD);
        let drawdownBreached = false;
        try {
          const [txs, agentState, snapshots] = await Promise.all([
            fetchTransactions(client, config.AGENT_ID),
            fetchAgentState(client, config.AGENT_ID),
            fetchSnapshots(client, config.AGENT_ID),
          ]);
          const vitals = computeVitals(txs, agentState, Date.now(), snapshots);
          if (vitals.burnPerHourUsd > 0) {
            burnRatePerHourUsd = vitals.burnPerHourUsd;
          }
          netWorthUsd = vitals.netWorthUsd;
          peakNetWorthUsd = vitals.peakUsd;
          // Sticky: once the worst drawdown ever crossed the cap, the DQ is permanent.
          drawdownBreached = vitals.maxDrawdownFraction >= config.MAX_DRAWDOWN_FRACTION;
        } catch (error: unknown) {
          log.warn('vitals calc failed — using rent-only burn + cash net worth', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        const decision = await runInnerTick({
          llm,
          supabase: client,
          config,
          balanceUsd: balanceAfterRent,
          burnRatePerHourUsd,
          netWorthUsd,
          peakNetWorthUsd,
          drawdownBreached,
          mustTrade,
        });
        log.info('decided', {
          tick: ticks,
          iterations: decision.iterations,
          summary: decision.summary,
        });
      } catch (error: unknown) {
        log.error('inner loop failed', {
          tick: ticks,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Mark the balance sheet after this tick's actions (cash + positions = net worth).
    // Eviction is on NET WORTH, not cash: an agent fully deployed in a token isn't
    // broke — it can liquidate to pay rent. It's only evicted when total worth ≤ 0.
    const netWorth = await recordSnapshot();
    if (netWorth !== null && !isAlive({ balance: netWorth, status: 'alive' })) {
      await markDead(client, config.AGENT_ID);
      log.error('EVICTED', { netWorth, ticks });
      break;
    }
    await checkGasTank();

    if (config.MAX_TICKS > 0 && ticks >= config.MAX_TICKS) {
      log.info('reached MAX_TICKS — stopping', { ticks });
      break;
    }

    await sleep(config.TICK_INTERVAL_MS);
  }

  log.info('worker stopped', { ticks });
}

try {
  await main();
} catch (error: unknown) {
  log.error('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
