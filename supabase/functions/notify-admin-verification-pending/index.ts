import { createClient } from 'npm:@supabase/supabase-js@2';

// Called client-side (professional-dashboard.js's handleUploadVerificationDoc)
// right after a professional uploads their verification document and
// professionals.verification_status flips to 'pending'. Pushes a Web Push
// notification to every admin device subscribed via admin.html's "Ativar
// notificações" button - same channel/table (push_subscriptions) already
// used by stripe-webhook/asaas-webhook for sale alerts, so no new opt-in is
// needed if the admin already enabled push for those.

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') as string;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') as string;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') as string;

const ROLE_LABELS: Record<string, string> = { logopedista: 'Fonoaudiólogo(a)', psicologo: 'Psicólogo(a)', professor: 'Professor(a)', outro: 'Outro' };

/* ========================= WEB PUSH (RFC 8291 / RFC 8292) =========================
   Same hand-rolled implementation as stripe-webhook/index.ts and
   asaas-webhook/index.ts (Deno's edge runtime has no confirmed-compatible
   port of the `web-push` npm package) - duplicated here rather than shared,
   matching how every other Edge Function in this project is self-contained. */

function base64UrlToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

async function importVapidPrivateKey(): Promise<CryptoKey> {
  const dRaw = base64UrlToUint8Array(VAPID_PRIVATE_KEY);
  const pubRaw = base64UrlToUint8Array(VAPID_PUBLIC_KEY);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: uint8ArrayToBase64Url(dRaw),
    x: uint8ArrayToBase64Url(pubRaw.slice(1, 33)),
    y: uint8ArrayToBase64Url(pubRaw.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function buildVapidJwt(audience: string): Promise<string> {
  const encoder = new TextEncoder();
  const headerB64 = uint8ArrayToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payloadB64 = uint8ArrayToBase64Url(encoder.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  })));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importVapidPrivateKey();
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput));
  return `${signingInput}.${uint8ArrayToBase64Url(new Uint8Array(signature))}`;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const t1 = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

async function encryptPayload(payload: Uint8Array, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const clientPublicKeyRaw = base64UrlToUint8Array(p256dhB64);
  const authSecret = base64UrlToUint8Array(authB64);

  const clientPublicKey = await crypto.subtle.importKey(
    'raw', clientPublicKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  ) as CryptoKeyPair;
  const asPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));

  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey }, asKeyPair.privateKey, 256
  ));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();

  const keyInfo = concatBytes(encoder.encode('WebPush: info\0'), clientPublicKeyRaw, asPublicKeyRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const paddedPlaintext = concatBytes(payload, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, paddedPlaintext));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicKeyRaw.length]), asPublicKeyRaw);

  return concatBytes(header, ciphertext);
}

async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: Record<string, unknown>) {
  const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(payload)), subscription.p256dh, subscription.auth);
  const endpointUrl = new URL(subscription.endpoint);
  const jwt = await buildVapidJwt(`${endpointUrl.protocol}//${endpointUrl.host}`);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_ANON_KEY') as string,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
    );

    // Derived from the caller's own auth, never taken from the request body -
    // this can only ever notify about the caller's own upload, no matter what
    // a spoofed payload might claim.
    const { data: professional } = await supabase.from('professionals')
      .select('full_name, role, verification_status')
      .eq('auth_user_id', user.id).maybeSingle();
    if (!professional || professional.verification_status !== 'pending') {
      return new Response(JSON.stringify({ sent: false, reason: 'not_pending' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) {
      return new Response(JSON.stringify({ sent: false, reason: 'push_not_configured' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: subs } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth');
    if (!subs?.length) {
      return new Response(JSON.stringify({ sent: false, reason: 'no_subscriptions' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const roleLabel = ROLE_LABELS[professional.role as string] || (professional.role as string) || '';
    const payload = {
      title: '📄 Novo comprovante de verificação',
      body: `${professional.full_name}${roleLabel ? ` (${roleLabel})` : ''} enviou um comprovante para revisão.`,
      url: 'admin.html',
    };

    let delivered = 0;
    await Promise.all(subs.map(async (sub) => {
      try {
        await sendWebPush(sub as { endpoint: string; p256dh: string; auth: string }, payload);
        delivered++;
      } catch (err) {
        console.error('Push send failed:', (err as Error).message);
        if (/ 404| 410/.test((err as Error).message)) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', (sub as { endpoint: string }).endpoint);
        }
      }
    }));

    return new Response(JSON.stringify({ sent: delivered > 0, delivered, total: subs.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('notify-admin-verification-pending error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
