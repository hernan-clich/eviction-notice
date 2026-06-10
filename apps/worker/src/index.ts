/**
 * Eviction Notice — agent worker.
 *
 * A persistent, always-on Node daemon (Render Background Worker). The outer
 * heartbeat ticks forever: accrue rent → recompute balance → check alive →
 * think (inner reason-and-act loop) → sleep. When the ledger balance hits zero
 * the agent is EVICTED and the loop halts permanently — no revivals.
 */

import { isAlive } from 'shared';

import { runInnerTick } from './agent.ts';
import { loadConfig } from './config.ts';
import { createAnthropicClient } from './llm.ts';
import { log } from './log.ts';
import { rentForInterval } from './rent.ts';
import {
  createClient,
  ensureBorn,
  fetchBalance,
  fetchStatus,
  insertTransaction,
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
      reasoning: `Rent accrued for ${config.TICK_INTERVAL_MS} ms of being alive.`,
    });

    const balanceAfterRent = await fetchBalance(client, config.AGENT_ID);
    log.info('tick', { tick: ticks, rent: -rent, balance: balanceAfterRent });

    if (!isAlive({ balance: balanceAfterRent, status: 'alive' })) {
      await markDead(client, config.AGENT_ID);
      log.error('EVICTED', { balance: balanceAfterRent, ticks });
      break;
    }

    // Think: gather data, consult the sizing skill, decide. A failure here
    // (model/network) must not evict the agent — log and keep the heartbeat.
    if (llm) {
      try {
        const decision = await runInnerTick({
          llm,
          supabase: client,
          config,
          balanceUsd: balanceAfterRent,
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
