import { runBacktest, type BacktestResult } from './backtest.ts';

/** Render the survival curves as an ASCII Kaplan-Meier chart. */
function render(result: BacktestResult): string {
  const lines: string[] = [];
  lines.push(
    `Survival curves - ${result.agents} agents over ${result.days} days (% still solvent at day end)\n`,
  );

  const header = [
    'strategy'.padEnd(16),
    ...Array.from({ length: result.days }, (_, d) => `d${d + 1}`.padStart(5)),
  ];
  lines.push(header.join(' '));

  for (const [name, stats] of Object.entries(result.byStrategy)) {
    const cells = stats.survivalByDay.map((fraction) =>
      `${Math.round(fraction * 100)}%`.padStart(5),
    );
    lines.push([name.padEnd(16), ...cells].join(' '));
  }

  lines.push('');
  for (const [name, stats] of Object.entries(result.byStrategy)) {
    const bar = '█'.repeat(Math.round(stats.survivedWindow * 30));
    lines.push(
      `${name.padEnd(16)} ${bar.padEnd(30)} ${Math.round(stats.survivedWindow * 100)}% survived the window · median ${stats.medianSurvivalDays.toFixed(1)}d`,
    );
  }
  return lines.join('\n');
}

const result = runBacktest({
  seed: 1,
  agents: 2000,
  days: 7,
  ticksPerDay: 24,
  config: {
    seedUsd: 20,
    rentPerHourUsd: 0.07,
    gasPerSwapUsd: 0.15,
    swapFeeRate: 0.0025,
    slippage: 0.001,
    maxDrawdownFraction: 0.3,
  },
  pathVolatility: 0.04,
  driftMean: 0.008,
  driftSpread: 0.02,
});

console.log(render(result));
