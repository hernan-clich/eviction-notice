import type { ReactNode } from 'react';

/**
 * A tiny, dependency-free markdown renderer for the agent's reasoning — handles
 * the subset Claude actually emits (**bold**, *italic*, `code`, "- " bullets,
 * line breaks). Kept deliberately small to preserve the terminal aesthetic.
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

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      flushList();
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
