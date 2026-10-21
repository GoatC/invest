'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { LABELS } from '@/lib/i18n';

import { signIn, type SignInState } from './actions';

const INITIAL: SignInState = { error: null, email: '' };

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, INITIAL);
  return (
    <form action={action} className="form narrow">
      <label className="field">
        <Bi {...LABELS.email} />
        <input type="email" name="email" autoComplete="username" defaultValue={state.email} required />
      </label>
      <label className="field">
        <Bi {...LABELS.password} />
        <input type="password" name="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p className="banner danger" role="alert">
          <Bi {...state.error} />
        </p>
      )}
      <button type="submit" className="button primary" disabled={pending}>
        <Bi {...(pending ? { en: 'Signing in…', zh: '登入中…' } : LABELS.signIn)} />
      </button>
    </form>
  );
}
