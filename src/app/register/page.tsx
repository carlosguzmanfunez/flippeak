export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import { RegisterForm } from '@/ui/auth/register-form';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Create account — FlipPeak',
  alternates: { canonical: '/register' },
};

export default function RegisterPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <RegisterForm />
      </main>
    </>
  );
}
