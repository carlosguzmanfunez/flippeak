import type { Metadata } from 'next';

import { RegisterForm } from '@/ui/auth/register-form';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Create your account — FlipPeak',
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
