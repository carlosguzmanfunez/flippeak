import type { Metadata } from 'next';
import { Instrument_Sans } from 'next/font/google';
import './globals.css';

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-instrument-sans',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://flippeak.vercel.app'),
  title: {
    default: 'FlipPeak — Your Time Rate determines your position',
    template: '%s — FlipPeak',
  },
  description:
    'A live marketplace for advertising attention. Your Time Rate determines your position; your budget determines how long you can hold it.',
  openGraph: {
    type: 'website',
    siteName: 'FlipPeak',
    title: 'FlipPeak — Your Time Rate determines your position',
    description:
      'A live marketplace for advertising attention. Set your Time Rate. Compete for position.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={instrumentSans.variable}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
