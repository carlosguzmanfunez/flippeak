export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import { LoginForm } from '@/ui/auth/login-form';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Sign in â€” FlipPeak',
  alternates: { canonical: '/login' },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string }>;
}) {
  const { registered } = await searchParams;

  return (
    <>
      <link rel="canonical" href="https://flippeak.vercel.app/login" />
      <SiteHeader />
      <main>
        <LoginForm justRegistered={registered === '1'} />
      </main>
    </>
  );
}
