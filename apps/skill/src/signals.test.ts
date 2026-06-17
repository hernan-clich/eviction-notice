import { describe, expect, it } from 'vitest';

import {
  deriveSignals,
  parseMarketRegime,
  parseTechnicalAnalysis,
  regimeMultiplier,
  rsiMomentum,
  signalsFromHub,
  type HubCaller,
  type RegimeSignal,
  type TechnicalSignal,
} from './signals.ts';
import { decideSizing } from './sizing.ts';

const greed: RegimeSignal = { fearGreed: 70 };

const goodHubCaller: HubCaller = (name) =>
  Promise.resolve(
    name === 'get_crypto_technical_analysis'
      ? { rsi_14: 64, macd_histogram: 0.5, price: 100, sma_30: 95, atr: 5 }
      : { fear_and_greed: 70 },
  );
const junkHubCaller: HubCaller = () => Promise.resolve({ junk: true });

describe('rsiMomentum', () => {
  it('is zero in weakness — never longs a downtrend or oversold "due to bounce"', () => {
    expect(rsiMomentum(30)).toBe(0);
    expect(rsiMomentum(50)).toBe(0);
  });
  it('ramps through the healthy-uptrend band and plateaus', () => {
    expect(rsiMomentum(56)).toBeCloseTo(0.5, 6);
    expect(rsiMomentum(62)).toBe(1);
    expect(rsiMomentum(65)).toBe(1);
  });
  it('tapers as it gets overbought — does not chase blow-offs', () => {
    expect(rsiMomentum(73)).toBeCloseTo(0.65, 6);
    expect(rsiMomentum(90)).toBe(0.3);
  });
});

describe('regimeMultiplier', () => {
  it('discounts edge hard in fear and lets it through in greed', () => {
    expect(regimeMultiplier(10)).toBe(0.3);
    expect(regimeMultiplier(35)).toBe(0.6);
    expect(regimeMultiplier(50)).toBe(0.85);
    expect(regimeMultiplier(70)).toBe(1);
  });
});

describe('deriveSignals', () => {
  it('produces a capped, confirmation-scaled edge on a clean momentum read', () => {
    const ta: TechnicalSignal = {
      rsi14: 63,
      macdHistogram: 0.5,
      price: 100,
      movingAverage: 95,
      atrPct: 0.06,
    };
    const d = deriveSignals(ta, greed);
    // momentum 1 × confirmation 1 × maxEdge 0.03 × regime 1 = 0.03
    expect(d.edge).toBeCloseTo(0.03, 6);
    expect(d.volatility).toBeCloseTo(0.06, 6);
    expect(d.components.macdConfirms).toBe(true);
    expect(d.components.trendConfirms).toBe(true);
  });

  it('gives no edge when momentum is absent, regardless of confirmation', () => {
    const ta: TechnicalSignal = { rsi14: 44, macdHistogram: 2, price: 100, movingAverage: 90 };
    expect(deriveSignals(ta, greed).edge).toBe(0);
  });

  it('halves toward the floor when MACD and trend do not confirm', () => {
    const confirmed: TechnicalSignal = {
      rsi14: 63,
      macdHistogram: 1,
      price: 100,
      movingAverage: 95,
    };
    const unconfirmed: TechnicalSignal = {
      rsi14: 63,
      macdHistogram: -1,
      price: 100,
      movingAverage: 105,
    };
    const e1 = deriveSignals(confirmed, greed).edge;
    const e2 = deriveSignals(unconfirmed, greed).edge;
    expect(e2).toBeCloseTo(e1 * 0.4, 6); // confirmation 0.4 vs 1.0
  });

  it('discounts the edge in a fearful regime', () => {
    const ta: TechnicalSignal = { rsi14: 63, macdHistogram: 1, price: 100, movingAverage: 95 };
    expect(deriveSignals(ta, { fearGreed: 10 }).edge).toBeCloseTo(0.03 * 0.3, 6);
  });

  it('floors and caps volatility, and falls back when ATR is absent', () => {
    const base = { rsi14: 63, macdHistogram: 1, price: 100, movingAverage: 95 };
    expect(deriveSignals({ ...base, atrPct: 0.001 }, greed).volatility).toBe(0.02); // floored
    expect(deriveSignals({ ...base, atrPct: 0.9 }, greed).volatility).toBe(0.25); // capped
    expect(deriveSignals(base, greed).volatility).toBe(0.05); // fallback
  });

  it('feeds decideSizing end to end — derived edge drives a real size/skip', () => {
    const strong: TechnicalSignal = {
      rsi14: 64,
      macdHistogram: 1,
      price: 100,
      movingAverage: 95,
      atrPct: 0.05,
    };
    const weak: TechnicalSignal = {
      rsi14: 48,
      macdHistogram: -1,
      price: 100,
      movingAverage: 105,
      atrPct: 0.05,
    };
    const sizing = {
      balanceUsd: 18,
      peakBalanceUsd: 20,
      burnRatePerHourUsd: 0.07,
      gasPerSwapUsd: 0.01,
      minPositionUsd: 1,
      cashReserveHours: 24,
    };

    const onStrong = deriveSignals(strong, greed);
    const onWeak = deriveSignals(weak, greed);
    expect(
      decideSizing({ ...sizing, edge: onStrong.edge, volatility: onStrong.volatility }).decision,
    ).toBe('trade');
    expect(
      decideSizing({ ...sizing, edge: onWeak.edge, volatility: onWeak.volatility }).decision,
    ).toBe('skip');
  });
});

describe('parsers (tolerant of payload shape)', () => {
  it('extracts nested, aliased TA fields', () => {
    const raw = {
      data: {
        indicators: { rsi_14: 61.5, macd: { histogram: 0.42 } },
        quote: { USD: { price: 612.3 } },
        moving_averages: { ema_30: 600 },
        atr: 30.6,
      },
    };
    const ta = parseTechnicalAnalysis(raw);
    expect(ta).not.toBeNull();
    expect(ta?.rsi14).toBeCloseTo(61.5, 6);
    expect(ta?.macdHistogram).toBeCloseTo(0.42, 6);
    expect(ta?.price).toBeCloseTo(612.3, 6);
    expect(ta?.atrPct).toBeCloseTo(30.6 / 612.3, 6); // absolute ATR → fraction of price
  });

  it('returns null when the essentials are missing (never sizes on a guess)', () => {
    expect(parseTechnicalAnalysis({ foo: 'bar' })).toBeNull();
  });

  it('defaults regime to neutral when Fear & Greed is absent, clamps to 0–100', () => {
    expect(parseMarketRegime({}).fearGreed).toBe(50);
    expect(parseMarketRegime({ fear_and_greed: 22 }).fearGreed).toBe(22);
  });
});

describe('signalsFromHub', () => {
  it('pulls TA + regime via the injected caller and derives signals', async () => {
    const d = await signalsFromHub(goodHubCaller, 1839);
    expect(d.edge).toBeGreaterThan(0);
    expect(d.volatility).toBeCloseTo(0.05, 6);
  });

  it('throws rather than size on an unparseable technical payload', async () => {
    await expect(signalsFromHub(junkHubCaller, 1)).rejects.toThrow(/refusing to size on a guess/);
  });
});
