import { describe, expect, it } from 'vitest';

import { SURVIVAL_VOICE, systemPrompt, type InnerTickDeps } from './agent.ts';
import { loadConfig } from './config.ts';

const minimalEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

// systemPrompt only reads config + the scalar vitals fields, never llm/supabase/mcp,
// so those can be stubbed away for a pure prompt-shape assertion.
function depsFor(mode: 'survival' | 'compete'): InnerTickDeps {
  return {
    llm: null as unknown as InnerTickDeps['llm'],
    supabase: null as unknown as InnerTickDeps['supabase'],
    config: loadConfig({ ...minimalEnv, AGENT_MODE: mode }),
    mcp: null,
    balanceUsd: 9,
    burnRatePerHourUsd: 0.1,
    netWorthUsd: 9,
    tradingEquityUsd: 16,
    peakTradingEquityUsd: 20,
    drawdownBreached: false,
    mustTrade: false,
  };
}

describe('systemPrompt — the tenant voice is survival-only', () => {
  it('injects the VOICE into the survival prompt', () => {
    expect(systemPrompt(depsFor('survival'), [])).toContain(SURVIVAL_VOICE);
  });

  it('never leaks the VOICE into the compete prompt', () => {
    expect(systemPrompt(depsFor('compete'), [])).not.toContain(SURVIVAL_VOICE);
  });
});

describe('SURVIVAL_VOICE house style', () => {
  it('carries no em or en dashes (the machine-prose tell we strip everywhere)', () => {
    expect(SURVIVAL_VOICE).not.toMatch(/[—–]/);
  });
});
