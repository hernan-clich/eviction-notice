import { isEligibleToken, LIQUID_TOKENS, survivalDesperation, survivalTier } from 'shared';
import { decideSizing } from 'skill';
import { z } from 'zod';

import { compactTrending, stripDefinitions, type McpCaller } from './cmc-mcp.ts';
import { cmcConfig, fetchQuotes, meteredFetchQuotes, resolveCmcId } from './cmc.ts';
import type { WorkerConfig } from './config.ts';
import { executeSwap } from './execution.ts';
import { runConversation, type LlmClient, type LlmTool, type ToolHandler } from './llm.ts';
import { log } from './log.ts';
import { closeProceedsUsd, swapFrictionUsd, type FrictionParams } from './paper-trade.ts';
import {
  closePosition,
  fetchOpenPositions,
  insertTransaction,
  openPosition,
  type AppSupabaseClient,
  type OpenPosition,
} from './supabase.ts';
import { callSizingSkill } from './x402-client.ts';

const getQuotesInput = z.object({ symbols: z.array(z.string()).min(1).max(10) });
const sizePositionInput = z.object({
  token: z.string(),
  edge: z.number(),
  volatility: z.number().positive(),
});
const openPositionInput = z.object({ token: z.string(), sizeUsd: z.number().positive() });
const closePositionInput = z.object({ positionId: z.number().int() });

const TOOLS: LlmTool[] = [
  {
    name: 'get_quotes',
    description:
      'Fetch live USD market quotes (price, 24h change, volume, market cap) for up to 10 token symbols from CoinMarketCap. Each call costs a small metered data fee. Use it to read the market and to mark open positions to market before closing.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Token symbols, e.g. ["BNB","CAKE"]',
        },
      },
      required: ['symbols'],
    },
  },
  {
    name: 'size_position',
    description:
      'Ask the Solvency-Aware Sizing skill how big a position to take, or whether to skip. Provide your estimated edge (expected fractional return, e.g. 0.02) and volatility (fractional downside risk, e.g. 0.05). Returns a position size + go/no-go decision tuned to keep the rent paid.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        edge: { type: 'number', description: 'Expected fractional return, e.g. 0.02 for +2%' },
        volatility: { type: 'number', description: 'Fractional downside risk, e.g. 0.05 for 5%' },
      },
      required: ['token', 'edge', 'volatility'],
    },
  },
  {
    name: 'open_position',
    description:
      'Open a paper long position: spend sizeUsd of cash to buy the token at the live price (paying gas + fees + slippage). Use the size the sizing skill recommended. Only call this when you have decided to trade.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        sizeUsd: { type: 'number', description: 'Cash to deploy, e.g. 12' },
      },
      required: ['token', 'sizeUsd'],
    },
  },
  {
    name: 'close_position',
    description:
      'Close an open position by id: sell back to cash at the live price (paying gas + fees + slippage), realising the P&L. Decide WHEN to close per the strategy — ride winners, cut losers; do not bank tiny gains on noise.',
    inputSchema: {
      type: 'object',
      properties: { positionId: { type: 'number' } },
      required: ['positionId'],
    },
  },
];

/** CMC Agent Hub signal tools — only offered when an MCP caller is available. */
const AGENT_HUB_TOOLS: LlmTool[] = [
  {
    name: 'get_technical_analysis',
    description:
      'CMC Agent Hub: pre-computed technical indicators for a token — RSI (7/14/21), MACD (line/signal/histogram), SMA/EMA (7/30/200), Fibonacci levels, pivot. Use it to judge momentum + overbought/oversold before estimating edge.',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string', description: 'Token symbol, e.g. "BNB"' } },
      required: ['token'],
    },
  },
  {
    name: 'get_market_regime',
    description:
      'CMC Agent Hub: overall market regime — total market-cap trend, BTC dominance, liquidity, and the Fear & Greed index. Use it to gauge risk-on vs risk-off before deploying.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_trending',
    description:
      'CMC Agent Hub: top trending crypto narratives/sectors with 24h/7d momentum and their lead coins — find where capital is rotating.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

export interface InnerTickDeps {
  llm: LlmClient;
  supabase: AppSupabaseClient;
  config: WorkerConfig;
  /** CMC Agent Hub signal caller (RSI/MACD/regime/trending). Null = not configured. */
  mcp: McpCaller | null;
  balanceUsd: number;
  /** All-in burn (rent + data + x402) — the same figure the dashboard shows. */
  burnRatePerHourUsd: number;
  /** Marked net worth (cash + open positions) — drives the survival tier + desperation. */
  netWorthUsd: number;
  /** All-time net-worth high-water mark — the true drawdown peak (DQ gate). */
  peakNetWorthUsd: number;
  /** The max-drawdown DQ has already been breached — void the cap, fight to survive. */
  drawdownBreached: boolean;
  mustTrade: boolean;
}

function frictionParams(config: WorkerConfig): FrictionParams {
  return {
    gasPerSwapUsd: config.GAS_PER_SWAP_USD,
    swapFeeRate: config.SWAP_FEE_RATE,
    slippage: config.SLIPPAGE,
  };
}

/** Human-readable price: 2 decimals for dollar-scale tokens, more precision for sub-dollar. */
function fmtPrice(price: number): string {
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toPrecision(3);
}

const URGENCY: Record<ReturnType<typeof survivalTier>, string> = {
  stable:
    'STATUS — STABLE: you are comfortably ahead of rent. Be selective; only deploy on a clear, high-conviction edge. Sitting in cash is a fine choice here.',
  strained:
    'STATUS — STRAINED: net worth is sinking and the burn is winning. Sitting in cash only DELAYS eviction, it does not prevent it. Lower your bar, hunt harder for a workable trade, and stop hoarding cash that will not matter once you are evicted.',
  'final-notice':
    'STATUS — FINAL NOTICE: eviction is imminent. Preserving cash no longer keeps the lights on — it just picks the day you lose the room. Take any positive-expectation shot you can find, favour high-volatility movers where one swing could actually make rent, and do NOT go quietly.',
};

const fmtPct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

function positionsLineOf(openPositions: OpenPosition[]): string {
  return openPositions.length > 0
    ? openPositions
        .map((p) => `#${p.id} ${p.token} $${p.sizeUsd.toFixed(2)} @ $${p.entryPx}`)
        .join('; ')
    : 'none';
}

/** Shared closing lines: Agent Hub signal tools, the daily-trade floor, the wrap-up. */
function appendCommonTail(lines: string[], deps: InnerTickDeps): void {
  if (deps.mcp) {
    lines.push(
      '- Use the CMC Agent Hub for real signals: get_technical_analysis(token) → RSI/MACD/MAs; get_market_regime → Fear & Greed + BTC dominance; get_trending → hot narratives. Ground your edge in these, not just the 24h % move.',
    );
  }
  if (deps.mustTrade) {
    lines.push(
      '- ⚠️ You have not traded within the required window — you must open one position this tick to satisfy the ≥1-trade/day rule. With no genuine setup, take the SMALLEST qualifying trade (minimum size) so the forced trade costs the least friction.',
    );
  }
  lines.push('- Be concise. End with a one- or two-sentence summary of what you did and why.');
}

/** Survival mode: the rent/eviction drama — optimise to keep a roof over its head. */
function survivalPrompt(deps: InnerTickDeps, openPositions: OpenPosition[]): string {
  const burn = deps.burnRatePerHourUsd;
  const runwayHours = burn > 0 ? deps.balanceUsd / burn : Number.POSITIVE_INFINITY;
  const tier = survivalTier(deps.netWorthUsd, deps.config.SEED_USD);

  const lines = [
    'You are Eviction Notice — an autonomous crypto trading agent on BNB Chain that must earn its own rent to keep a roof over its head.',
    'Your NET WORTH — cash plus open positions marked to market — is what keeps the roof on; if it hits zero you are EVICTED permanently. Optimise to stay housed, not for maximum return.',
    'Rent, data, and trades are paid from CASH. Deploying cash into a position does NOT lose it (net worth is unchanged) — but it cuts liquidity. Keep enough cash to cover rent, or you may be forced to liquidate at a bad price.',
    '',
    `Net worth: $${deps.netWorthUsd.toFixed(4)} of $${deps.config.SEED_USD.toFixed(2)} seed. Cash (liquidity): $${deps.balanceUsd.toFixed(4)} | all-in burn (rent + data + fees) $${burn.toFixed(4)}/hour | cash runway ≈ ${runwayHours.toFixed(1)} hours.`,
    URGENCY[tier],
    `Open positions: ${positionsLineOf(openPositions)}.`,
    '',
    'Each tick:',
    '- get_quotes to read the market and to mark any open positions to market.',
    '- For open positions, decide whether to close_position (bank a gain or cut a loss) — they only realise P&L when closed.',
    '- To enter: estimate edge + volatility, call size_position, and if it says trade, call open_position with the recommended size.',
    '- Every swap pays gas + fees + slippage. Only trade when expected edge clearly beats that friction.',
    `- Trade ONLY eligible tokens — trades outside the list do not count toward your P&L. Focus on the deepest, most-liquid ones: ${LIQUID_TOKENS.join(', ')}.`,
  ];
  if (deps.drawdownBreached) {
    lines.push(
      '⚠️ DRAWDOWN CAP BREACHED — in the competition you are already DISQUALIFIED, and it is permanent (max drawdown is the worst peak-to-trough over the run; it never resets, no market move undoes it). The cap no longer protects anything. Stop guarding it: deploy aggressively to claw back and survive. Go down swinging, not quietly.',
    );
  }
  appendCommonTail(lines, deps);
  return lines.join('\n');
}

/** Compete mode: the judged-run brief — maximise return, stay deployed, never breach the cap. */
function competePrompt(deps: InnerTickDeps, openPositions: OpenPosition[]): string {
  const maxDD = deps.config.MAX_DRAWDOWN_FRACTION;
  const peak = deps.peakNetWorthUsd;
  const drawdown = peak > 0 ? Math.max(0, (peak - deps.netWorthUsd) / peak) : 0;
  const headroom = Math.max(0, maxDD - drawdown);

  const lines = [
    'You are Eviction Notice — an autonomous trading agent that must earn its keep on BNB Chain, now entered in a 1-week live trading competition (you sign your own trades, fully self-custody).',
    'OBJECTIVE: earn your keep by posting the best total return you can. You are scored on real PnL, hour by hour — idle cash pays no rent, so you only get ahead while deployed in tokens that rise. Sitting in cash never makes rent.',
    `EVICTION LINE — the one hard rule: if your net worth ever falls ${fmtPct(maxDD)} below its peak, you are EVICTED from the competition on the spot — out of the running no matter how strong your returns were. Peak $${peak.toFixed(2)} | net worth $${deps.netWorthUsd.toFixed(2)} → ${fmtPct(drawdown)} down (${fmtPct(headroom)} of room before eviction). Stay well clear: as you approach the line, cut size and de-risk.`,
    `Cash: $${deps.balanceUsd.toFixed(2)} | open positions: ${positionsLineOf(openPositions)}.`,
    '',
    'How to earn your keep — trade less, but better; most ticks should be NO trade:',
    '- Read the regime FIRST: get_market_regime (Fear & Greed + BTC dominance), then get_quotes + get_trending. In a fearful/downtrend tape, do NOT fight it with broad longs — holding USDT (an eligible position) is the right defensive trade while the field bleeds. But cash is your DEFAULT, not your destination: keep hunting the few names with genuine relative strength or a confirmed turn (momentum up, reclaiming a rising MA, a hot narrative rotating in) and STRIKE those — that selectivity, not constant exposure, is how you post a positive return without fighting the tape. Never buy capitulation dips on oversold alone; oversold only gets more oversold.',
    '- Enter on MOMENTUM, not reversals — confirmed strength (price above rising moving averages, MACD turning up, real upward momentum), never "RSI is oversold, it is due to bounce." Riding strength has an edge here; catching falling knives does not.',
    '- Be selective and honest: only deploy when you can name a concrete, signal-backed reason the token rises clearly MORE than the ~1% round-trip friction. Otherwise your edge is ~0 — hold cash. Do NOT inflate the edge you hand size_position to justify a trade. When a setup is genuinely strong, size it up (within your eviction-line headroom) so the win beats friction.',
    '- RIDE WINNERS, CUT LOSERS: do NOT close a position just because it is up a little — hold while momentum holds and let it run. Exit only on a momentum reversal, a small stop on a loser, or to de-risk near the eviction line. Small losses + occasional bigger wins is the whole game.',
    '- Mechanics: estimate edge + volatility honestly → size_position (it keeps you the safe side of the line) → open_position at the size it returns; rotate a weak position into a stronger one via close_position. Make at least one trade per day (the rule) but do NOT overtrade.',
    `- Trade ONLY eligible tokens — trades outside the list do not count. Deepest/most-liquid: ${LIQUID_TOKENS.join(', ')}.`,
  ];
  if (deps.drawdownBreached) {
    lines.push(
      '⚠️ You have crossed the eviction line — you are EVICTED from the competition, and there is no coming back (it is permanent). Keep trading if you like, but the placement is gone.',
    );
  }
  appendCommonTail(lines, deps);
  return lines.join('\n');
}

function systemPrompt(deps: InnerTickDeps, openPositions: OpenPosition[]): string {
  return deps.config.AGENT_MODE === 'compete'
    ? competePrompt(deps, openPositions)
    : survivalPrompt(deps, openPositions);
}

/** Run one inner reason-and-act loop: think, (maybe) trade, record the decision. */
export async function runInnerTick(
  deps: InnerTickDeps,
): Promise<{ summary: string; iterations: number }> {
  const agentId = deps.config.AGENT_ID;
  const openPositions = await fetchOpenPositions(deps.supabase, agentId);

  const handlers: Record<string, ToolHandler> = {
    get_quotes: async (input) => {
      const parsed = getQuotesInput.safeParse(input);
      if (!parsed.success) {
        return `Invalid input: ${parsed.error.message}`;
      }
      const quotes = await meteredFetchQuotes(
        { supabase: deps.supabase, config: deps.config, agentId },
        parsed.data.symbols,
      );
      return JSON.stringify(quotes);
    },

    size_position: async (input) => {
      const parsed = sizePositionInput.safeParse(input);
      if (!parsed.success) {
        return `Invalid input: ${parsed.error.message}`;
      }
      // Compete mode deploys freely (no rent reserve to hoard, no survival
      // desperation) and gates purely on edge-vs-friction within the drawdown cap.
      // Survival mode keeps the rent reserve + desperation gradient.
      const compete = deps.config.AGENT_MODE === 'compete';
      const sizingInput = {
        balanceUsd: deps.balanceUsd,
        peakBalanceUsd: Math.max(deps.balanceUsd, deps.config.SEED_USD),
        netWorthUsd: deps.netWorthUsd,
        peakNetWorthUsd: deps.peakNetWorthUsd,
        maxDrawdownFraction: deps.config.MAX_DRAWDOWN_FRACTION,
        drawdownBreached: deps.drawdownBreached,
        cashReserveHours: compete ? 0 : deps.config.CASH_RESERVE_HOURS,
        desperation: compete ? 0 : survivalDesperation(deps.netWorthUsd, deps.config.SEED_USD),
        burnRatePerHourUsd: deps.burnRatePerHourUsd,
        edge: parsed.data.edge,
        volatility: parsed.data.volatility,
        gasPerSwapUsd: deps.config.GAS_PER_SWAP_USD,
        minPositionUsd: deps.config.MIN_POSITION_USD,
        mustTrade: deps.mustTrade,
      };

      // Pay-to-think: when the x402 skill is configured, the agent buys its own
      // sizing decision over x402 (an `x402_fee` ledger expense) instead of
      // sizing in-process. Unset → in-process (tests, backtest).
      if (deps.config.SKILL_URL) {
        const { decision, receipt } = await callSizingSkill(sizingInput, {
          url: deps.config.SKILL_URL,
          payer: deps.config.X402_PAYER,
          settlement: deps.config.X402_SETTLEMENT,
          maxPaymentAtomic: deps.config.X402_MAX_PAYMENT_ATOMIC,
          preferNetwork: deps.config.TWAK_CHAIN,
        });
        if (deps.config.LOG_RESPONSES) {
          log.info('skill response', { input: sizingInput, decision, receipt });
        }
        const cost = deps.config.SKILL_CALL_COST_USD;
        await insertTransaction(deps.supabase, {
          agentId,
          kind: 'expense',
          amount: -cost,
          reason: 'x402_fee',
          reasoning: `Paid the Solvency-Aware Sizing skill to think ($${cost.toFixed(2)} via x402).`,
          meta: {
            skill: 'solvency-aware-sizing',
            txHash: receipt.transaction,
            network: deps.config.BSC_NETWORK,
            simulated: receipt.simulated,
          },
        });
        return JSON.stringify(decision);
      }

      return JSON.stringify(decideSizing(sizingInput));
    },

    open_position: async (input) => {
      const parsed = openPositionInput.safeParse(input);
      if (!parsed.success) {
        return `Invalid input: ${parsed.error.message}`;
      }
      if (!isEligibleToken(parsed.data.token)) {
        return `${parsed.data.token} is not in the eligible universe — trades outside it don't count toward P&L. Choose an eligible token.`;
      }
      const [quote] = await fetchQuotes(cmcConfig(deps.config), [parsed.data.token]);
      if (!quote) {
        return `No live price for ${parsed.data.token}; cannot open.`;
      }
      // Execute (or simulate) the swap first — a live failure must not leave a
      // phantom position. baseAmount = USDT spent ≈ sizeUsd.
      const swap = await executeSwap(
        { config: deps.config },
        { side: 'open', token: quote.symbol, baseAmount: parsed.data.sizeUsd },
      );
      // Live: reconcile against what actually happened on-chain — real USDT spent,
      // real token received → effective entry price (slippage is in the price, not
      // a separate USDT fee; gas is paid in BNB, outside this economy). Paper: the
      // requested size at the quote price with a modeled friction.
      // `fill` carries the real on-chain numbers (non-null by construction) or is
      // null in paper mode — no assertions, the narrowing is genuine.
      const fill =
        !swap.simulated && swap.outAmount !== null && swap.outAmount > 0
          ? { usdtSpent: swap.inAmount ?? parsed.data.sizeUsd, tokenQty: swap.outAmount }
          : null;
      const usdtSpent = fill ? fill.usdtSpent : parsed.data.sizeUsd;
      const entryPx = fill ? fill.usdtSpent / fill.tokenQty : quote.priceUsd;
      const friction = fill ? 0 : swapFrictionUsd(parsed.data.sizeUsd, frictionParams(deps.config));
      const cashOut = fill ? fill.usdtSpent : parsed.data.sizeUsd + friction;
      const id = await openPosition(deps.supabase, {
        agentId,
        token: quote.symbol,
        sizeUsd: usdtSpent,
        entryPx,
      });
      await insertTransaction(deps.supabase, {
        agentId,
        kind: 'expense',
        amount: -cashOut,
        reason: 'trade_open',
        reasoning: `Opened #${id}: $${usdtSpent.toFixed(2)} ${quote.symbol} @ $${fmtPrice(entryPx)}.`,
        meta: {
          positionId: id,
          token: quote.symbol,
          sizeUsd: usdtSpent,
          entryPx,
          frictionUsd: friction,
          txHash: swap.txHash,
          network: deps.config.BSC_NETWORK,
          simulated: swap.simulated,
        },
      });
      return JSON.stringify({
        positionId: id,
        token: quote.symbol,
        entryPx,
        frictionUsd: friction,
      });
    },

    close_position: async (input) => {
      const parsed = closePositionInput.safeParse(input);
      if (!parsed.success) {
        return `Invalid input: ${parsed.error.message}`;
      }
      const position = openPositions.find((p) => p.id === parsed.data.positionId);
      if (!position) {
        return `No open position #${parsed.data.positionId}.`;
      }
      const [quote] = await fetchQuotes(cmcConfig(deps.config), [position.token]);
      if (!quote) {
        return `No live price for ${position.token}; cannot close.`;
      }
      // Sell the held token quantity back to the base. baseAmount = tokens held;
      // with an effective entry price this equals exactly what we received on open.
      const tokensHeld = position.sizeUsd / position.entryPx;
      const swap = await executeSwap(
        { config: deps.config },
        { side: 'close', token: position.token, baseAmount: tokensHeld },
      );
      // Live: real USDT proceeds from the swap; P&L vs the USDT actually spent to
      // open (no modeled friction). Paper: the modeled proceeds at the quote price.
      // Real USDT proceeds from the swap (null in paper mode → modeled proceeds).
      // `?? ` and `!== null` narrow it — no assertions. (`??` not `||`, so a real $0 stands.)
      const realProceeds = swap.simulated ? null : swap.outAmount;
      const proceeds =
        realProceeds ??
        closeProceedsUsd(
          position.sizeUsd,
          position.entryPx,
          quote.priceUsd,
          frictionParams(deps.config),
        );
      const openCost =
        realProceeds === null
          ? position.sizeUsd + swapFrictionUsd(position.sizeUsd, frictionParams(deps.config))
          : position.sizeUsd;
      const netPnl = proceeds - openCost;
      const exitPx =
        realProceeds !== null && tokensHeld > 0 ? realProceeds / tokensHeld : quote.priceUsd;
      await closePosition(deps.supabase, {
        id: position.id,
        exitPx,
        pnlUsd: netPnl,
      });
      await insertTransaction(deps.supabase, {
        agentId,
        kind: 'income',
        amount: proceeds,
        reason: 'trade_close',
        reasoning: `Closed #${position.id} ${position.token} @ $${fmtPrice(exitPx)}: net P&L $${netPnl.toFixed(2)}.`,
        meta: {
          positionId: position.id,
          exitPx,
          netPnlUsd: netPnl,
          txHash: swap.txHash,
          network: deps.config.BSC_NETWORK,
          simulated: swap.simulated,
        },
      });
      return JSON.stringify({ positionId: position.id, exitPx, netPnlUsd: netPnl });
    },
  };

  // CMC Agent Hub signal tools — wired only when the MCP caller is configured. Each
  // call is metered as a data_call (visible in the feed), like the quotes feed.
  if (deps.mcp) {
    const mcp = deps.mcp;
    const logHubCall = (reasoning: string, signal: string): Promise<void> =>
      insertTransaction(deps.supabase, {
        agentId,
        kind: 'expense',
        amount: -deps.config.CMC_DATA_COST_USD,
        reason: 'data_call',
        reasoning,
        meta: { source: 'cmc/agent-hub', signal },
      });

    handlers['get_technical_analysis'] = async (input) => {
      const parsed = z.object({ token: z.string() }).safeParse(input);
      if (!parsed.success) return `Invalid input: ${parsed.error.message}`;
      try {
        const id = await resolveCmcId(cmcConfig(deps.config), parsed.data.token);
        const ta = await mcp('get_crypto_technical_analysis', { id: String(id) });
        await logHubCall(`Pulled RSI/MACD for ${parsed.data.token} via CMC Agent Hub.`, 'ta');
        return JSON.stringify(ta);
      } catch (error) {
        return `Agent Hub technical analysis failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    };

    handlers['get_market_regime'] = async () => {
      try {
        const raw = await mcp('get_global_metrics_latest', {});
        await logHubCall(
          'Read the market regime (Fear & Greed, dominance) via CMC Agent Hub.',
          'regime',
        );
        return JSON.stringify(stripDefinitions(raw));
      } catch (error) {
        return `Agent Hub market regime failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    };

    handlers['get_trending'] = async () => {
      try {
        const raw = await mcp('trending_crypto_narratives', {});
        await logHubCall('Read trending narratives via CMC Agent Hub.', 'trending');
        return JSON.stringify(compactTrending(raw));
      } catch (error) {
        return `Agent Hub trending failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
  }

  const outcome = await runConversation({
    llm: deps.llm,
    system: systemPrompt(deps, openPositions),
    userText:
      'A new tick has begun. Assess the market, manage any open positions, and decide what to do.',
    tools: deps.mcp ? [...TOOLS, ...AGENT_HUB_TOOLS] : TOOLS,
    handlers,
    maxIterations: deps.config.AGENT_MAX_ITERATIONS,
  });

  const summary = outcome.finalText.length > 0 ? outcome.finalText : '(no decision)';
  await insertTransaction(deps.supabase, {
    agentId,
    kind: 'expense',
    amount: 0,
    reason: 'decision',
    reasoning: summary,
    meta: { iterations: outcome.iterations },
  });

  return { summary, iterations: outcome.iterations };
}
