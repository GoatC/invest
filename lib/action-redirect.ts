import { revalidatePath } from 'next/cache';
import { redirect as go } from 'next/navigation';

/**
 * A server action's redirect that also drops the pages the phone keeps from earlier taps (the
 * router cache, next.config.ts staleTimes), so every page shows what the action saved. Server
 * actions import this in place of next/navigation's redirect.
 */
export function redirect(url: string): never {
  revalidatePath('/', 'layout');
  go(url);
}

/** For an action that answers with a state instead of a redirect. */
export function refreshPages(): void {
  revalidatePath('/', 'layout');
}
