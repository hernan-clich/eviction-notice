import { explorerTxUrl, type BscNetwork, type Transaction } from 'shared';

import { formatFeedTime, formatSignedUsd } from '@/lib/ui';

import { Markdown } from './markdown';

interface TxRef {
  url: string;
  simulated: boolean;
  short: string;
}

function txLink(meta: Transaction['meta']): TxRef | null {
  if (!meta) return null;
  const hash = meta['txHash'];
  if (typeof hash !== 'string') return null;
  const network: BscNetwork = meta['network'] === 'testnet' ? 'testnet' : 'mainnet';
  return {
    url: explorerTxUrl(hash, network),
    simulated: meta['simulated'] === true,
    short: `${hash.slice(0, 6)}…${hash.slice(-4)}`,
  };
}

const INFLOW = new Set(['seed', 'trade_close']);
const OUTFLOW = new Set(['rent', 'data_call', 'x402_fee', 'trade_open']);

function tone(reason: string): { color: string; chip: string } {
  if (INFLOW.has(reason)) {
    return { color: '#4ef0a0', chip: 'border-phosphor/40 text-phosphor' };
  }
  if (OUTFLOW.has(reason)) {
    return { color: '#ff5468', chip: 'border-alarm/40 text-alarm' };
  }
  return { color: '#6a7570', chip: 'border-line text-muted' };
}

function metaNumber(meta: Transaction['meta'], key: string): number | null {
  if (!meta) return null;
  const value = meta[key];
  return typeof value === 'number' ? value : null;
}

/**
 * What the trade row should actually show. The ledger amount is gross cash flow —
 * a +$14.77 close looks like a win even when the round trip lost money — so trades
 * report their honest number instead: friction paid to open, realised P&L to close.
 */
function displayAmount(tx: Transaction): { value: number; color: string; tag?: string } | null {
  if (tx.reason === 'trade_open') {
    const friction = metaNumber(tx.meta, 'frictionUsd');
    return friction === null ? null : { value: -friction, color: '#ff5468', tag: 'friction' };
  }
  if (tx.reason === 'trade_close') {
    const pnl = metaNumber(tx.meta, 'netPnlUsd');
    return pnl === null
      ? null
      : { value: pnl, color: pnl >= 0 ? '#4ef0a0' : '#ff5468', tag: 'P&L' };
  }
  if (tx.reason === 'decision' || tx.amount === 0) return null;
  return { value: tx.amount, color: tone(tx.reason).color };
}

/** Strip a leading status emoji (✅/❌/⚠️) the model sometimes prefixes onto its decision. */
function cleanReasoning(text: string): string {
  return text.replace(/^\p{Extended_Pictographic}[️]?\s*/u, '');
}

function TxLink({ link }: { link: TxRef }) {
  // Simulated txs aren't on-chain — render the hash as non-clickable so it never
  // dead-links to a 404 explorer page. Only real txs get a clickable BscScan link.
  if (link.simulated) {
    return (
      <span
        className="text-muted ml-2 inline-flex items-center gap-1.5 align-baseline text-xs not-italic"
        title="Simulated — no on-chain transaction (real tx lands with live execution)"
      >
        <span
          className="font-display text-muted/80 rounded-sm border-current px-1 text-[9px] tracking-widest uppercase"
          style={{ border: '1px solid currentColor' }}
        >
          sim
        </span>
        <span>{link.short}</span>
      </span>
    );
  }
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="ml-2 inline-flex items-center gap-1.5 align-baseline text-xs not-italic"
      style={{ color: '#7cc7ff' }}
      title="View transaction on BscScan"
    >
      <span className="underline decoration-dotted underline-offset-4">{link.short}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}

export function Feed({
  transactions,
  bornMs,
}: {
  transactions: readonly Transaction[];
  bornMs: number | null;
}) {
  const feed = [...transactions].reverse();
  if (feed.length === 0) {
    return <p className="text-muted text-sm">Waiting for the agent to do something…</p>;
  }
  return (
    <ul className="divide-line flex flex-col divide-y">
      {feed.map((tx) => {
        const t = tone(tx.reason);
        const isDecision = tx.reason === 'decision';
        const link = txLink(tx.meta);
        const amt = displayAmount(tx);
        return (
          <li key={tx.id} className="flex animate-[feed-in_0.35s_ease-out] flex-col gap-1 py-3">
            <div className="flex items-baseline gap-3 text-sm">
              <time className="text-muted w-16 shrink-0 text-xs" dateTime={tx.ts}>
                {formatFeedTime(tx.ts, bornMs)}
              </time>
              <span
                className={`font-display shrink-0 border px-1.5 py-0.5 text-[10px] tracking-widest uppercase ${t.chip}`}
              >
                {tx.reason}
              </span>
              {amt ? (
                <span
                  className="ml-auto flex shrink-0 items-baseline gap-1.5 tabular-nums"
                  style={{ color: amt.color }}
                >
                  {amt.tag ? (
                    <span className="text-muted text-[10px] tracking-wider uppercase">
                      {amt.tag}
                    </span>
                  ) : null}
                  {formatSignedUsd(amt.value)}
                </span>
              ) : null}
            </div>
            {tx.reasoning ? (
              isDecision ? (
                <Markdown
                  text={cleanReasoning(tx.reasoning)}
                  className="text-ink/90 mt-0.5 text-sm leading-relaxed"
                />
              ) : (
                <p className="text-muted mt-0.5 text-sm leading-snug italic">
                  {tx.reasoning}
                  {link ? <TxLink link={link} /> : null}
                </p>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
