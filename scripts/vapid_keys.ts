/**
 * Makes the app's VAPID key pair for Web Push, once (docs/web-push.md). It prints the two keys for
 * you to paste into Vercel, GitHub secrets and .env.local; nothing is saved or sent anywhere. The
 * private key is a secret: never commit it or paste it anywhere else.
 */
import { newVapidKeys } from '../lib/push.ts';

const { publicKey, privateKey } = newVapidKeys();
console.log('A new VAPID key pair 新的 VAPID 金鑰（只顯示這一次）:');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('');
console.log('Paste them as docs/web-push.md says; the private key is a secret. 請依 docs/web-push.md 貼上；私鑰（PRIVATE）必須保密。');
