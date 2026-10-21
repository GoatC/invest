'use server';

import { redirect } from 'next/navigation';

import type { Bilingual } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';

export interface SignInState {
  error: Bilingual | null;
  /** Kept so the field is not emptied when the form resets after a failed attempt. */
  email: string;
}

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    return { error: { en: 'Enter your email and password.', zh: '請輸入電子郵件與密碼。' }, email };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One message for every failure, so the page never tells which part was wrong.
  if (error) return { error: { en: 'Sign-in failed: check the email and password.', zh: '登入失敗：請確認電子郵件與密碼。' }, email };
  redirect('/holdings');
}
