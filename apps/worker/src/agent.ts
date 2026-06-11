import { isEligibleToken, LIQUID_TOKENS } from 'shared';
import { decideSizing } from 'skill';
import { z } from 'zod';

import { cmcConfig, fetchQuotes, meteredFetchQuotes } from './cmc.ts';
import type { WorkerConfig } from './config.ts';
import { executeSwap } from './execution.ts';
import { runConversation, type LlmClient, type LlmTool, type ToolHandler } from './llm.ts';
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
      'Ask the Solvency-Aware Sizing skill how big a position to take, or whether to skip. Provide your estimated edge (expected fractional return, e.g. 0.02) and volatility (fractional downside risk, e.g. 0.05). Returns a position size + go/no-go decision optimised for survival.',
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
      'Close an open position by id: sell back to cash at the live price (paying gas + fees + slippage), realising the P&L. Close winners to bank gains or losers to cut risk.',
    inputSchema: {
      type: 'object',
      properties: { positionId: { type: 'number' } },
      required: ['positionId'],
    },
  },
];

export interface InnerTickDeps {
  llm: LlmClient;
  supabase: AppSupabaseClient;
  config: WorkerConfig;
  balanceUsd: number;
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

function systemPrompt(deps: InnerTickDeps, openPositions: OpenPosition[]): string {
  const burn = deps.config.RENT_PER_HOUR_USD;
  const runwayHours = burn > 0 ? deps.balanceUsd / burn : Number.POSITIVE_INFINITY;
  const positionsLine =
    openPositions.length > 0
      ? openPositions
          .map((p) => `#${p.id} ${p.token} $${p.sizeUsd.toFixed(2)} @ $${p.entryPx}`)
          .join('; ')
      : 'none';

  const lines = [
    'You are Eviction Notice — an autonomous crypto trading agent on BNB Chain that must earn its own survival.',
    'Your NET WORTH — cash plus open positions marked to market — is your life force; if it hits zero you are EVICTED permanently. Optimise for survival, not maximum return.',
    'Rent, data, and trades are paid from CASH. Deploying cash into a position does NOT lose it (net worth is unchanged) — but it cuts liquidity. Keep enough cash to cover rent, or you may be forced to liquidate at a bad price.',
    '',
    `Cash (liquidity): $${deps.balanceUsd.toFixed(4)} | burn $${burn.toFixed(4)}/hour | cash runway ≈ ${runwayHours.toFixed(1)} hours.`,
    `Open positions: ${positionsLine}.`,
    '',
    'Each tick:',
    '- get_quotes to read the market and to mark any open positions to market.',
    '- For open positions, decide whether to close_position (bank a gain or cut a loss) — they only realise P&L when closed.',
    '- To enter: estimate edge + volatility, call size_position, and if it says trade, call open_position with the recommended size.',
    '- Every swap pays gas + fees + slippage. Only trade when expected edge clearly beats that friction.',
    `- Trade ONLY eligible tokens — trades outside the list do not count toward your P&L. Focus on the deepest, most-liquid ones: ${LIQUID_TOKENS.join(', ')}.`,
  ];
  if (deps.mustTrade) {
    lines.push(
      '- ⚠️ You have not traded within the required window. You MUST open at least one qualifying position this tick or risk disqualification — take the least-bad viable trade.',
    );
  }
  lines.push('- Be concise. End with a one- or two-sentence summary of what you did and why.');
  return lines.join('\n');
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
      const sizingInput = {
        balanceUsd: deps.balanceUsd,
        peakBalanceUsd: Math.max(deps.balanceUsd, deps.config.SEED_USD),
        burnRatePerHourUsd: deps.config.RENT_PER_HOUR_USD,
        edge: parsed.data.edge,
        volatility: parsed.data.volatility,
        gasPerSwapUsd: deps.config.GAS_PER_SWAP_USD,
        minPositionUsd: deps.config.MIN_POSITION_USD,
        cashReserveHours: deps.config.CASH_RESERVE_HOURS,
        mustTrade: deps.mustTrade,
      };

      // Pay-to-think: when the x402 skill is configured, the agent buys its own
      // sizing decision over x402 (an `x402_fee` ledger expense) instead of
      // sizing in-process. Unset → in-process (tests, backtest).
      if (deps.config.SKILL_URL) {
        const { decision, receipt } = await callSizingSkill(sizingInput, {
          url: deps.config.SKILL_URL,
          payer: deps.config.X402_PAYER,
        });
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

  const outcome = await runConversation({
    llm: deps.llm,
    system: systemPrompt(deps, openPositions),
    userText:
      'A new tick has begun. Assess the market, manage any open positions, and decide what to do.',
    tools: TOOLS,
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
