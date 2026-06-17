/**
 * Signal derivation — CoinMarketCap Agent Hub → (edge, volatility).
 *
 * The sizing engine (`decideSizing`) takes an `edge` (expected fractional return)
 * and a `volatility` (fractional downside). This module derives BOTH **in code**,
 * deterministically, from Agent Hub signals — so the strategy is self-contained
 * and reproducible end to end, not dependent on a model eyeballing the charts.
 *
 * The mapping is deliberately conservative and encodes one philosophy: ride
 * CONFIRMED upward momentum, never catch falling knives, and don't fight a
 * fearful tape. It produces a positive edge only when momentum and trend agree,
 * caps it, and discounts it in risk-off regimes. It is a grounded heuristic, not
 * a calibrated alpha — its job is to make the edge honest and replayable, and to
 * feed the sizing engine, which is where the survival advantage actually lives.
 */

const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi);
const pct = (n: number): string => `${(n * 100).toFixed(2)}%`;

/** Normalised technical-analysis signal (what the derivation actually consumes). */
export interface TechnicalSignal {
  /** RSI(14), 0–100. */
  rsi14: number;
  /** MACD histogram (line − signal). Sign = momentum direction; >0 is bullish. */
  macdHistogram: number;
  /** Last price. */
  price: number;
  /** A trend moving average (SMA/EMA ~30). Price above it = trend confirmation. */
  movingAverage: number;
  /** Optional ATR as a fraction of price (volatility proxy). */
  atrPct?: number;
}

/** Normalised market-regime signal. */
export interface RegimeSignal {
  /** CMC Fear & Greed index, 0 (extreme fear) – 100 (extreme greed). */
  fearGreed: number;
}

export interface DerivedSignals {
  /** Expected fractional return for `decideSizing` (e.g. 0.02 = +2%). */
  edge: number;
  /** Fractional downside risk for `decideSizing` (e.g. 0.05 = 5%). */
  volatility: number;
  /** Human-legible derivation breakdown. */
  rationale: string;
  components: {
    rsiMomentum: number;
    macdConfirms: boolean;
    trendConfirms: boolean;
    confirmation: number;
    regimeMultiplier: number;
  };
}

/** Tuning constants — conservative by design; exposed for the backtest to sweep. */
export interface DeriveOptions {
  /** Hard ceiling on the derived edge (no single read claims more than this). */
  maxEdge: number;
  /** Volatility floor — never divide sizing by a near-zero risk. */
  minVolatility: number;
  /** Volatility cap — clamp absurd ATR readings. */
  maxVolatility: number;
  /** Volatility used when no ATR is available. */
  fallbackVolatility: number;
}

export const DEFAULT_DERIVE_OPTIONS: DeriveOptions = {
  maxEdge: 0.03,
  minVolatility: 0.02,
  maxVolatility: 0.25,
  fallbackVolatility: 0.05,
};

/**
 * RSI as a momentum score in [0,1]. Zero in weakness (≤50 — we do not long
 * downtrends or buy oversold "it's due to bounce"), ramps to a peak in the
 * healthy-uptrend band, then tapers as it gets overbought (don't chase blow-offs).
 */
export function rsiMomentum(rsi: number): number {
  if (rsi <= 50) return 0;
  if (rsi < 62) return (rsi - 50) / 12; // 50→62 ramps 0→1
  if (rsi <= 68) return 1; // healthy uptrend plateau
  if (rsi < 78) return 1 - 0.7 * ((rsi - 68) / 10); // 68→78 tapers 1→0.3
  return 0.3; // overbought: minimal add, not a fresh long thesis
}

/** Map the Fear & Greed index to an edge multiplier — discount risk in fear. */
export function regimeMultiplier(fearGreed: number): number {
  if (fearGreed < 25) return 0.3; // extreme fear — barely any edge gets through
  if (fearGreed < 45) return 0.6; // fear — heavily discounted
  if (fearGreed <= 55) return 0.85; // neutral
  return 1; // greed / risk-on — edge passes
}

/**
 * Derive (edge, volatility) from Agent Hub signals. Pure and deterministic:
 * same signals in → same numbers out. This is the function the backtest replays
 * and the skill exposes; no I/O, no randomness.
 */
export function deriveSignals(
  ta: TechnicalSignal,
  regime: RegimeSignal,
  options: DeriveOptions = DEFAULT_DERIVE_OPTIONS,
): DerivedSignals {
  const momentum = rsiMomentum(ta.rsi14);
  const macdConfirms = ta.macdHistogram > 0;
  const trendConfirms = ta.price > ta.movingAverage;

  // Confirmation multiplier in [0.4, 1]: an RSI uptrend with no MACD/trend
  // backing is heavily discounted; full agreement lets the momentum through.
  const confirmation = 0.4 + (macdConfirms ? 0.3 : 0) + (trendConfirms ? 0.3 : 0);
  const regimeMult = regimeMultiplier(regime.fearGreed);

  const edge = clamp(momentum * confirmation * options.maxEdge * regimeMult, 0, options.maxEdge);

  const volatility =
    ta.atrPct === undefined
      ? options.fallbackVolatility
      : clamp(ta.atrPct, options.minVolatility, options.maxVolatility);

  const rationale =
    edge <= 0
      ? `No long edge: RSI ${ta.rsi14.toFixed(0)} shows no confirmed upward momentum — hold.`
      : `Edge ${pct(edge)}: RSI ${ta.rsi14.toFixed(0)} momentum${
          macdConfirms ? ', MACD up' : ''
        }${trendConfirms ? ', above MA' : ''}, regime ×${regimeMult.toFixed(2)} (F&G ${regime.fearGreed.toFixed(0)}); vol ${pct(volatility)}.`;

  return {
    edge,
    volatility,
    rationale,
    components: {
      rsiMomentum: momentum,
      macdConfirms,
      trendConfirms,
      confirmation,
      regimeMultiplier: regimeMult,
    },
  };
}

// --- tolerant parsers: extract the normalised signals from raw Hub payloads ----
// The Agent Hub's exact JSON shape varies by tool/version, so we search the
// payload for the first numeric value under any of a set of known key aliases
// (case-insensitive, nested). This keeps the derivation robust without pinning
// it to one payload schema.

function findNumber(value: unknown, aliases: readonly string[], depth = 0): number | undefined {
  if (depth > 8 || value === null || typeof value !== 'object') return undefined;
  const wanted = new Set(aliases.map((a) => a.toLowerCase()));
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  // Prefer a direct key hit at this level before recursing.
  for (const [key, v] of entries) {
    if (wanted.has(key.toLowerCase()) && typeof v === 'number' && Number.isFinite(v)) return v;
    if (
      wanted.has(key.toLowerCase()) &&
      typeof v === 'string' &&
      v.trim() !== '' &&
      Number.isFinite(Number(v))
    ) {
      return Number(v);
    }
  }
  for (const [, v] of entries) {
    const nested = findNumber(v, aliases, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Best-effort normalise a `get_crypto_technical_analysis` payload. Returns null if the essentials are missing. */
export function parseTechnicalAnalysis(raw: unknown): TechnicalSignal | null {
  const rsi14 = findNumber(raw, ['rsi_14', 'rsi14', 'rsi']);
  const price = findNumber(raw, ['price', 'close', 'current_price', 'last']);
  const macdHistogram = findNumber(raw, ['macd_histogram', 'macd_hist', 'histogram', 'hist']) ?? 0;
  const movingAverage =
    findNumber(raw, ['sma_30', 'ema_30', 'sma30', 'ema30', 'sma', 'ema', 'ma']) ?? price ?? 0;
  const atrPctRaw = findNumber(raw, ['atr_pct', 'atr_percent']);
  const atrAbs = findNumber(raw, ['atr']);
  if (rsi14 === undefined || price === undefined) return null;
  const atrPct = atrPctRaw ?? (atrAbs !== undefined && price > 0 ? atrAbs / price : undefined);
  const signal: TechnicalSignal = { rsi14, macdHistogram, price, movingAverage };
  if (atrPct !== undefined) signal.atrPct = atrPct;
  return signal;
}

/** Best-effort normalise a `get_global_metrics_latest` payload into a regime signal. */
export function parseMarketRegime(raw: unknown): RegimeSignal {
  const fearGreed =
    findNumber(raw, ['fear_and_greed', 'fear_greed', 'fearGreed', 'fng', 'value']) ?? 50;
  return { fearGreed: clamp(fearGreed, 0, 100) };
}

// --- thin Hub adapter ----------------------------------------------------------
// Injected caller (same contract as the worker's CMC MCP client) so the skill
// genuinely consumes the Agent Hub without taking a hard dependency on the MCP
// SDK. Pass a function that calls one Hub tool and returns its parsed JSON.

export type HubCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Pull TA + regime from the Agent Hub and derive (edge, volatility). Throws if
 * the technical payload can't be parsed (so a caller never sizes on a guess).
 */
export async function signalsFromHub(
  call: HubCaller,
  cmcId: string | number,
  options: DeriveOptions = DEFAULT_DERIVE_OPTIONS,
): Promise<DerivedSignals> {
  const [taRaw, regimeRaw] = await Promise.all([
    call('get_crypto_technical_analysis', { id: String(cmcId) }),
    call('get_global_metrics_latest', {}),
  ]);
  const ta = parseTechnicalAnalysis(taRaw);
  if (ta === null) {
    throw new Error('could not parse Agent Hub technical analysis — refusing to size on a guess');
  }
  return deriveSignals(ta, parseMarketRegime(regimeRaw), options);
}
