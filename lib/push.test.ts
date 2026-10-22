import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import webpush from 'web-push';

import { newVapidKeys, pushToAll, TIME_TO_LIVE, vapidFromEnv, type DeviceSubscription, type PushPayload, type Sender, type Vapid } from './push';

const VAPID: Vapid = { ...newVapidKeys(), subject: 'mailto:owner@example.com' };
const PAYLOAD: PushPayload = { title: 'Weekly review 每週檢視', body: 'Rules: all on track. 規則：全部正常。', url: '/', tag: 'weekly' };

/** A device: its key pair and auth secret, as a browser makes them when it subscribes. */
function device(id = 1) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription: DeviceSubscription = {
    id,
    endpoint: `https://push.example.com/send/${id}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
  return { ecdh, auth, subscription };
}

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** Decrypts an aes128gcm push body (RFC 8188 and RFC 8291) with the device's keys. */
function decrypt(body: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const serverKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const shared = ecdh.computeSecret(serverKey);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey, Buffer.from([1])]);
  const ikm = hmac(hmac(auth, shared), keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  // The last record ends with the delimiter 0x02, then any padding of zeros.
  return padded.subarray(0, padded.lastIndexOf(2)).toString('utf8');
}

describe('vapidFromEnv', () => {
  it('reads the key pair and subject, the public key under either name', () => {
    assert.deepEqual(vapidFromEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@example.com' }), {
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:a@example.com',
    });
  });

  it('names what is missing, and refuses a subject that is not mailto: or https:', () => {
    assert.deepEqual(vapidFromEnv({}), { missing: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] });
    assert.deepEqual(vapidFromEnv({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'owner@example.com' }), { missing: ['VAPID_SUBJECT'] });
  });
});

describe('a push as the device receives it', () => {
  it('is encrypted to the device, so only it can read the title, body and page to open', () => {
    const { ecdh, auth, subscription } = device();
    const request = webpush.generateRequestDetails(subscription, JSON.stringify(PAYLOAD), { TTL: TIME_TO_LIVE, vapidDetails: VAPID });
    assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(request.headers['TTL'], TIME_TO_LIVE);
    // Signed with the app's VAPID key: the push service checks it against the key the device subscribed with.
    assert.match(String(request.headers['Authorization']), new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${VAPID.publicKey}$`));
    assert.deepEqual(JSON.parse(decrypt(request.body as Buffer, ecdh, auth)), PAYLOAD);
  });
});

describe('pushToAll', () => {
  it('sends to every device, reports the gone ones to delete, and keeps others going when one fails', async () => {
    const calls: Array<{ endpoint: string; payload: string; ttl: number | undefined }> = [];
    const send: Sender = async (subscription, payload, options) => {
      calls.push({ endpoint: subscription.endpoint, payload, ttl: options.TTL });
      if (subscription.endpoint.endsWith('/2')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      if (subscription.endpoint.endsWith('/3')) throw Object.assign(new Error('Too many'), { statusCode: 429 });
      return {};
    };
    const result = await pushToAll([device(1).subscription, device(2).subscription, device(3).subscription, device(4).subscription], PAYLOAD, VAPID, send);
    assert.deepEqual(result, { delivered: [1, 4], gone: [2], errors: ['push service 429'] });
    assert.equal(calls.length, 4);
    assert.deepEqual(JSON.parse(calls[0]?.payload ?? '{}'), PAYLOAD);
    assert.equal(calls[0]?.ttl, TIME_TO_LIVE);
  });

  it('reports a push service it could not reach without its address', async () => {
    const send: Sender = async () => {
      throw new Error('getaddrinfo ENOTFOUND push.example.com');
    };
    const result = await pushToAll([device(1).subscription], PAYLOAD, VAPID, send);
    assert.deepEqual(result.errors, ['push service unreachable: getaddrinfo ENOTFOUND push.example.com']);
  });
});
