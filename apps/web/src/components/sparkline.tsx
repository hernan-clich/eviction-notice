import type { BalancePoint } from 'shared';

import { formatUsd } from '@/lib/ui';

const WIDTH = 600;
const HEIGHT = 140;
const PAD = 8;

/**
 * Balance over time, framed as a descent toward the $0 eviction floor: the y-axis
 * runs from $0 (evicted) up to the seed/peak, so you watch the race against burn.
 */
export function Sparkline({
  series,
  color,
  seedUsd,
}: {
  series: readonly BalancePoint[];
  color: string;
  seedUsd: number;
}) {
  const balances = series.map((p) => p.balanceUsd);
  const ceil = Math.max(seedUsd, ...balances, 1) * 1.05;
  const yFor = (balance: number) => HEIGHT - PAD - (balance / ceil) * (HEIGHT - 2 * PAD);
  const seedY = yFor(seedUsd);
  const floorY = HEIGHT - PAD;

  let line = '';
  let area = '';
  let lastPoint: readonly [number, number] | null = null;
  if (series.length >= 2) {
    const xs = series.map((p) => p.tsMs);
    const minX = Math.min(...xs);
    const spanX = Math.max(...xs) - minX || 1;
    const points = series.map((p) => {
      const x = PAD + ((p.tsMs - minX) / spanX) * (WIDTH - 2 * PAD);
      return [x, yFor(p.balanceUsd)] as const;
    });
    line = points
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
    lastPoint = points.at(-1) ?? null;
    area = `${line} L${(lastPoint?.[0] ?? WIDTH).toFixed(1)} ${floorY} L${PAD} ${floorY} Z`;
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-36 w-full"
        preserveAspectRatio="none"
        aria-label="balance over time"
      >
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* seed + eviction gridlines */}
        <line
          x1={0}
          y1={seedY}
          x2={WIDTH}
          y2={seedY}
          stroke="#6a7570"
          strokeWidth={1}
          strokeDasharray="4 5"
          opacity={0.5}
        />
        <line
          x1={0}
          y1={floorY}
          x2={WIDTH}
          y2={floorY}
          stroke="#ff5468"
          strokeWidth={1}
          strokeDasharray="4 5"
          opacity={0.45}
        />
        {area ? <path d={area} fill="url(#spark-fill)" stroke="none" /> : null}
        {line ? (
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 3px ${color})` }}
          />
        ) : null}
        {lastPoint ? <circle cx={lastPoint[0]} cy={lastPoint[1]} r={3} fill={color} /> : null}
      </svg>
      <span className="text-muted absolute top-0 right-0 text-[10px]">
        {formatUsd(seedUsd, 0)} seed
      </span>
      <span className="text-alarm absolute bottom-0 left-0 text-[10px]">$0 evicted</span>
    </div>
  );
}
