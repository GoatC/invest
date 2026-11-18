import { Bi, Zh } from '@/components/bi';
import { LABELS } from '@/lib/i18n';

import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <section className="card narrow">
      <h1>
        <Zh {...LABELS.signIn} />
      </h1>
      <p className="muted">
        <Bi
          en="Use the account you created in Supabase. New sign-ups are closed."
          zh="請使用你在 Supabase 建立的帳號；新註冊已關閉。"
        />
      </p>
      <LoginForm />
    </section>
  );
}
