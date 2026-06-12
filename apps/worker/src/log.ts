/** Minimal structured logger — one JSON line per event (Render-friendly). */

type LogLevel = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

function emit(level: LogLevel, msg: string, fields?: Fields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (msg: string, fields?: Fields): void => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields): void => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields): void => emit('error', msg, fields),
};

/** Stringify a value for a log field, truncated so one response can't flood the line. */
export function preview(value: unknown, max = 3000): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (s === undefined) return 'undefined';
  return s.length > max ? `${s.slice(0, max)}…[${s.length} chars total]` : s;
}
