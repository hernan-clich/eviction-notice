import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Eviction Notice',
  description: 'An autonomous trading agent that has to earn its own survival.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 font-mono text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
