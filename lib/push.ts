/**
 * Sending Web Push (Phase 1, step 10): each push goes to every device the owner turned
 * notifications on for (push_subscriptions), encrypted to that device's keys and signed with the
 * app's VAPID key, so the phone's push service knows it is from this app. The keys come from the
 * environment, never git: the nightly and notify jobs read them from GitHub secrets, the app from
 * Vercel's environment variables (docs/web-push.md). Server-only.
 */
import webpush from 'web-push';

/** The VAPID key pair and the contact the push services may reach (mailto: or https:). */
export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const NAMES = { publicKey: ['VAPID_PUBLIC_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY'], privateKey: ['VAPID_PRIVATE_KEY'], subject: ['VAPID_SUBJECT'] } as const;

/** The VAPID settings from the environment, or the names of the ones missing. */
export function vapidFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): Vapid | { missing: string[] } {
  const pick = (names: readonly string[]) => names.map((name) => env[name]?.trim()).find((value) => value);
  const publicKey = pick(NAMES.publicKey);
  const privateKey = pick(NAMES.privateKey);
  const subject = pick(NAMES.subject);
  const missing = [
    ...(publicKey ? [] : ['VAPID_PUBLIC_KEY']),
    ...(privateKey ? [] : ['VAPID_PRIVATE_KEY']),
    ...(subject && /^(mailto:|https:)/.test(subject) ? [] : ['VAPID_SUBJECT']),
  ];
  return publicKey && privateKey && subject && missing.length === 0 ? { publicKey, privateKey, subject } : { missing };
}

/** A device's subscription as push_subscriptions holds it. */
export interface DeviceSubscription {
  id: number;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What the service worker shows (public/sw.js). */
export interface PushPayload {
  title: string;
  body: string;
  /** The page a tap opens. */
  url: string;
  /** A newer push with the same tag replaces the older one on the device. */
  tag: string;
}

export type Sender = (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

/** How long a push service keeps a push for a phone that is off: a day. */
export const TIME_TO_LIVE = 24 * 60 * 60;

export interface PushResult {
  /** Subscriptions the push service accepted the push for. */
  delivered: number[];
  /** Subscriptions the push service says are gone (the device turned notifications off): delete them. */
  gone: number[];
  /** Other refusals, without their endpoints. */
  errors: string[];
}

function statusOf(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : undefined;
}

/** Sends one push to every device; one device failing does not stop the others. */
export async function pushToAll(subscriptions: readonly DeviceSubscription[], payload: PushPayload, vapid: Vapid, send: Sender = webpush.sendNotification): Promise<PushResult> {
  const result: PushResult = { delivered: [], gone: [], errors: [] };
  const body = JSON.stringify(payload);
  const options: webpush.RequestOptions = { TTL: TIME_TO_LIVE, urgency: 'normal', vapidDetails: vapid };
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await send({ endpoint: subscription.endpoint, keys: subscription.keys }, body, options);
        result.delivered.push(subscription.id);
      } catch (err) {
        const status = statusOf(err);
        if (status === 404 || status === 410) result.gone.push(subscription.id);
        else result.errors.push(`push service ${status ?? 'unreachable'}${err instanceof Error && status === undefined ? `: ${err.message.split('\n')[0]}` : ''}`);
      }
    }),
  );
  result.delivered.sort((a, b) => a - b);
  result.gone.sort((a, b) => a - b);
  return result;
}

/** A new VAPID key pair (docs/web-push.md runs this once, through npm run vapid-keys). */
export function newVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
