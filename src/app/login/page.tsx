import type { Metadata } from 'next';

import { LoginForm } from '@/ui/auth/login-form';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Sign in — FlipPeak',
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
      <SiteHeader />
      <main>
        <LoginForm justRegistered={registered === '1'} />
      </main>
    </>
  );
}
