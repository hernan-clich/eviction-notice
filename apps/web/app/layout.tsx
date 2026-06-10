import type { Metadata } from 'next';
import { IBM_Plex_Mono, Martian_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

const display = Martian_Mono({ subsets: ['latin'], variable: '--font-martian', display: 'swap' });
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'EVICTION NOTICE — earning its keep',
  description:
    'An autonomous trading agent that pays its own rent. Watch it earn its survival, or get evicted trying.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="bg-bg text-ink min-h-screen font-mono antialiased">{children}</body>
    </html>
  );
}
