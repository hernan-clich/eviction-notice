import type { ReactNode } from 'react';

/**
 * A tiny, dependency-free markdown renderer for the agent's reasoning - handles
 * the subset Claude actually emits (**bold**, *italic*, `code`, "- " bullets,
 * GFM pipe tables, line breaks). Kept deliberately small to preserve the
 * terminal aesthetic.
 */

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    // Matched groups are non-empty when present (each pattern requires ≥1 char).
    const [, bold, code, star, underscore] = match;
    if (bold) {
      nodes.push(
        <strong key={key} className="text-ink font-semibold">
          {bold}
        </strong>,
      );
    } else if (code) {
      nodes.push(
        <code key={key} className="bg-line text-phosphor px-1">
          {code}
        </code>,
      );
    } else {
      nodes.push(<em key={key}>{star ?? underscore ?? ''}</em>);
    }
    key += 1;
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

const BULLET = /^[-*]\s+(.*)$/;
const RULE = /^([-*_])\1{2,}$/;

/** Split a `| a | b |` row into trimmed cells, dropping the outer pipes. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((cell) => cell.trim());
}

/** A GFM header/body separator: every cell is just dashes (with optional :align). */
function isSeparatorRow(line: string): boolean {
  if (!line.includes('|') && !line.includes('-')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** A pipe table is a header row immediately followed by a dash separator row. */
function isTableStart(lines: string[], i: number): boolean {
  const header = lines[i]?.trim() ?? '';
  const separator = lines[i + 1]?.trim() ?? '';
  return header.includes('|') && isSeparatorRow(separator);
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={key} className="ml-1 flex flex-col gap-1">
          {listItems}
        </ul>,
      );
      key += 1;
      listItems = [];
    }
  };

  const renderTable = (header: string[], rows: string[][]) => (
    <div key={key} className="-mx-1 overflow-x-auto">
      <table className="border-line w-full border-collapse border text-xs">
        <thead>
          <tr>
            {header.map((cell, c) => (
              <th
                key={c}
                className="border-line text-muted border px-2 py-1 text-left font-semibold tracking-wide uppercase"
              >
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {header.map((_, c) => (
                <td key={c} className="border-line tabular-nums border px-2 py-1 align-top">
                  {renderInline(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (line === '') {
      flushList();
      continue;
    }
    if (RULE.test(line)) {
      flushList();
      blocks.push(<hr key={key} className="border-line my-1 border-t" />);
      key += 1;
      continue;
    }
    if (isTableStart(lines, i)) {
      flushList();
      const header = splitRow(line);
      i += 2; // skip the header (read) + the separator row
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().includes('|')) {
        rows.push(splitRow(lines[i] ?? ''));
        i += 1;
      }
      i -= 1; // the outer loop will advance past the last consumed row
      blocks.push(renderTable(header, rows));
      key += 1;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      listItems.push(
        <li key={key} className="flex gap-2">
          <span className="text-muted shrink-0">›</span>
          <span>{renderInline(bullet[1] ?? '')}</span>
        </li>,
      );
      key += 1;
      continue;
    }
    flushList();
    blocks.push(<p key={key}>{renderInline(line)}</p>);
    key += 1;
  }
  flushList();

  return <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>{blocks}</div>;
}
