import type { Metadata } from 'next';

import { RegisterForm } from '@/ui/auth/register-form';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Create account â€” FlipPeak',
  alternates: { canonical: '/register' },
};

export default function RegisterPage() {
  return (
    <>
      <link rel="canonical" href="https://flippeak.vercel.app/register" />
<SiteHeader />
      <main>
        <RegisterForm />
      </main>
    </>
  );
}
