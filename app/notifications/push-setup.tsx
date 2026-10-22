'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { Bi } from '@/components/bi';
import type { Bilingual } from '@/lib/i18n';

import { removeDevice, saveSubscription, sendTest, type TestState } from './actions';

type Status = 'checking' | 'unsupported' | 'home-screen' | 'not-configured' | 'denied' | 'off' | 'on' | 'working';

const STATUS: Record<Status, Bilingual> = {
  checking: { en: 'Checking this device…', zh: '正在檢查這台裝置…' },
  unsupported: { en: 'This browser cannot receive Web Push.', zh: '這個瀏覽器無法接收網頁推播。' },
  'home-screen': {
    en: 'On an iPhone or iPad, pushes reach the app only once it is on the Home Screen: in Safari, Share → Add to Home Screen, then open it from its icon and come back here.',
    zh: 'iPhone 或 iPad 需要先把 App 加入主畫面才能收到推播：在 Safari 按「分享」→「加入主畫面」，再從主畫面的圖示打開 App，回到這一頁。',
  },
  'not-configured': {
    en: "The app's public VAPID key is not set: add NEXT_PUBLIC_VAPID_PUBLIC_KEY in Vercel (docs/web-push.md), then redeploy.",
    zh: 'App 的 VAPID 公開金鑰尚未設定：請在 Vercel 加入 NEXT_PUBLIC_VAPID_PUBLIC_KEY（見 docs/web-push.md），再重新部署。',
  },
  denied: {
    en: "Notifications are blocked for this app. Allow them in the device's settings (iPhone: Settings → Notifications → Long-View Invest), then reload.",
    zh: '這個 App 的通知已被封鎖。請到裝置設定中允許（iPhone：設定 → 通知 → 長期投資），再重新整理。',
  },
  off: { en: 'Notifications are off on this device.', zh: '這台裝置尚未開啟推播。' },
  on: { en: 'Notifications are on for this device.', zh: '這台裝置已開啟推播。' },
  working: { en: 'Working…', zh: '處理中…' },
};

/** The VAPID public key, base64url, as the bytes PushManager wants. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** A short name for the device, so the list says which is which. */
function deviceName(): string {
  const agent = navigator.userAgent;
  const device = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Macintosh/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : 'Device';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '';
  return browser ? `${device} · ${browser}` : device;
}

function isAppleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const TEST_STATE: TestState = { message: null, ok: false };

/** Turns Web Push on or off for this device, and sends a test to every device. */
export function PushSetup({ publicKey, devices }: { publicKey: string | null; devices: ReadonlyArray<{ id: number; endpoint: string }> }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('checking');
  const [message, setMessage] = useState<Bilingual | null>(null);
  const [test, testAction, testing] = useActionState(sendTest, TEST_STATE);
  const known = devices.map((device) => device.endpoint).join('\n');

  // After a test the device list and the log have changed (a device that left is gone).
  useEffect(() => {
    if (test.message) router.refresh();
  }, [test, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      let next: Status;
      if (!supported) next = isAppleMobile() && !standalone() ? 'home-screen' : 'unsupported';
      else if (!publicKey) next = 'not-configured';
      else {
        const registration = await navigator.serviceWorker.register('/sw.js');
        const current = await registration.pushManager.getSubscription();
        next = current && known.split('\n').includes(current.endpoint) ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off';
      }
      if (!cancelled) setStatus(next);
    })().catch(() => {
      if (!cancelled) setStatus('unsupported');
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, known]);

  async function turnOn() {
    if (!publicKey) return;
    setStatus('working');
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      // A subscription made with another key (an older VAPID pair) has to go first.
      const old = await registration.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const saved = await saveSubscription({ ...subscription.toJSON(), deviceName: deviceName() });
      setMessage(saved.message);
      setStatus(saved.ok ? 'on' : 'off');
      router.refresh();
    } catch (err) {
      setMessage({ en: `Could not turn notifications on: ${err instanceof Error ? err.message : String(err)}`, zh: `無法開啟推播：${err instanceof Error ? err.message : String(err)}` });
      setStatus('off');
    }
  }

  async function turnOff() {
    setStatus('working');
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    const subscription = await registration?.pushManager.getSubscription();
    const device = devices.find((candidate) => candidate.endpoint === subscription?.endpoint);
    await subscription?.unsubscribe();
    if (device) {
      const form = new FormData();
      form.set('id', String(device.id));
      await removeDevice(form);
    }
    setStatus('off');
    router.refresh();
  }

  return (
    <div className="form">
      <p className={status === 'on' ? 'banner ok' : status === 'denied' || status === 'not-configured' ? 'banner warn' : 'banner info'} role="status" id="push-status">
        <Bi {...STATUS[status]} />
      </p>
      {message && (
        <p className="muted small">
          <Bi {...message} />
        </p>
      )}
      <div className="row">
        {status === 'off' && (
          <button type="button" className="button primary" onClick={turnOn}>
            <Bi en="Turn on notifications on this device" zh="在這台裝置開啟推播" />
          </button>
        )}
        {status === 'on' && (
          <button type="button" className="button" onClick={turnOff}>
            <Bi en="Turn them off on this device" zh="關閉這台裝置的推播" />
          </button>
        )}
        <form action={testAction}>
          <button type="submit" className="button" disabled={testing || devices.length === 0}>
            <Bi {...(testing ? { en: 'Sending…', zh: '傳送中…' } : { en: 'Send a test to every device', zh: '傳送測試推播到所有裝置' })} />
          </button>
        </form>
      </div>
      {test.message && (
        <p className={test.ok ? 'banner ok' : 'banner warn'} role="alert">
          <Bi {...test.message} />
        </p>
      )}
    </div>
  );
}
