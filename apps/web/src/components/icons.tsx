/**
 * Inlined icons from Tabler Icons (https://tabler.io/icons, MIT licensed) — the
 * exact `refresh` and `list-details` glyphs, as raw SVG so we pull in no webfont
 * or dependency. Stroke geometry is verbatim; size is a prop. `currentColor`
 * inherits the surrounding text colour.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className: string | undefined) {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
}

/** Tabler `refresh`. */
export function RefreshIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
    </svg>
  );
}

/** Tabler `player-play`. */
export function PlayIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M7 4v16l13 -8z" />
    </svg>
  );
}

/** Tabler `player-pause`. */
export function PauseIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
      <path d="M14 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
    </svg>
  );
}

/** Tabler `list-details`. */
export function ListDetailsIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M13 5h8" />
      <path d="M13 9h5" />
      <path d="M13 15h8" />
      <path d="M13 19h5" />
      <path d="M3 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
      <path d="M3 14m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
    </svg>
  );
}
