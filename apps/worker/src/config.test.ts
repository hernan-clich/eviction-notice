import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const minimalEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

describe('loadConfig', () => {
  it('applies the seed-economy defaults', () => {
    const config = loadConfig(minimalEnv);
    expect(config.AGENT_ID).toBe('agent-0');
    expect(config.SEED_USD).toBe(20);
    expect(config.RENT_PER_HOUR_USD).toBe(0.07);
    expect(config.TICK_INTERVAL_MS).toBe(1_800_000);
    expect(config.MAX_TICKS).toBe(0);
  });

  it('coerces numeric env strings', () => {
    const config = loadConfig({ ...minimalEnv, SEED_USD: '50', MAX_TICKS: '3' });
    expect(config.SEED_USD).toBe(50);
    expect(config.MAX_TICKS).toBe(3);
  });

  it('throws when required config is missing', () => {
    expect(() => loadConfig({})).toThrow(/Invalid worker configuration/);
  });

  it('rejects a non-URL Supabase URL', () => {
    expect(() => loadConfig({ ...minimalEnv, SUPABASE_URL: 'not-a-url' })).toThrow();
  });

  it('accepts an ISO TRADING_STARTS_AT and leaves it unset by default', () => {
    expect(loadConfig(minimalEnv).TRADING_STARTS_AT).toBeUndefined();
    const config = loadConfig({ ...minimalEnv, TRADING_STARTS_AT: '2026-06-22T00:00:00Z' });
    expect(config.TRADING_STARTS_AT).toBe('2026-06-22T00:00:00Z');
  });

  it('rejects a non-ISO TRADING_STARTS_AT (a typo would never activate)', () => {
    expect(() => loadConfig({ ...minimalEnv, TRADING_STARTS_AT: 'june 22' })).toThrow(
      /Invalid worker configuration/,
    );
  });
});
