import { createClient } from 'npm:@supabase/supabase-js@2';

const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') ?? 'https://api.asaas.com/v3';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') as string;
const FROM_ADDRESS = 'Kapi da Ilha do Foco <kapi@viscaree.com.br>';
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_CLOUD_TOKEN') as string;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') as string;
const META_PIXEL_ID = '1359613756236046';
const META_CAPI_ACCESS_TOKEN = Deno.env.get('META_CAPI_ACCESS_TOKEN') as string;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') as string;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') as string;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') as string;
// generateLink has no way to infer where the app actually lives - without an
// explicit redirectTo it falls back to the Supabase project's configured Site
// URL, which here points at a stale, SSO-protected preview deployment instead
// of production. Matches the exact origin index.html's Google login already
// uses (window.location.origin, no trailing slash). The game itself still
// lives on the Vercel subdomain - only vendas.html moved to the custom domain.
const APP_ORIGIN = 'https://interativo-pi.vercel.app';
// vendas.html (checkout + Meta Pixel) now lives on the custom domain - used
// only for the CAPI event_source_url below, never for the magic-link redirect.
const SALES_ORIGIN = 'https://www.viscarekids.com';

function firstName(fullName: string) {
  return (fullName || '').trim().split(/\s+/)[0] || fullName;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Server-side counterpart of the client Pixel Purchase call vendas.html fires
// (see check-pix-payment-status) - same event_id shared between both so Meta
// dedupes them into a single Purchase instead of double-counting. This one is
// the reliable source of truth (fires here regardless of whether the
// customer's browser ever calls the fast-path status check), best-effort so
// a CAPI hiccup never fails the webhook itself.
async function sendPurchaseCapi(eventId: string, email: string, value: number, currency: string, match?: { fbc?: string; fbp?: string; clientIp?: string; clientUserAgent?: string }) {
  if (!META_CAPI_ACCESS_TOKEN || !email) return;
  try {
    // fbc/fbp (+ IP/UA when available) let Meta match this sale to the ad
    // click that drove it - a hashed e-mail alone gives poor match quality
    // and the sale won't attribute to a campaign even though the event lands.
    const userData: Record<string, unknown> = { em: [await sha256Hex(email)] };
    if (match?.fbc) userData.fbc = match.fbc;
    if (match?.fbp) userData.fbp = match.fbp;
    if (match?.clientIp) userData.client_ip_address = match.clientIp;
    if (match?.clientUserAgent) userData.client_user_agent = match.clientUserAgent;
    const payload = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: `${SALES_ORIGIN}/vendas.html`,
        event_id: eventId,
        user_data: userData,
        custom_data: { value, currency },
      }],
    };
    const res = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error('Purchase CAPI failed:', await res.text());
  } catch (err) {
    console.error('Purchase CAPI error:', (err as Error).message);
  }
}

/* ========================= WEB PUSH (RFC 8291 / RFC 8292) ========================= */
// Deno's edge runtime has no confirmed-compatible port of the `web-push` npm
// package (it leans on Node's `https` module internally), so this signs the
// VAPID JWT and encrypts the payload by hand with Web Crypto - same primitives,
// no extra dependency to break at import time.

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

// WebCrypto's ECDSA signature output is already raw r||s (IEEE P1363), which
// is exactly the format JWS ES256 wants - no DER re-encoding needed.
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

// HKDF-Extract-then-Expand (RFC 5869); every length we need here is <= 32
// bytes (the SHA-256 output size), so a single expand block always suffices.
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const t1 = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

// Web Push message encryption per RFC 8291 (aes128gcm content-coding, RFC 8188).
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

  // Single-record message: a trailing 0x02 delimiter marks it as the last
  // (and only) record, no further padding needed for a payload this small.
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

function formatMoney(value: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : 'R$';
  return `${symbol} ${value.toFixed(2).replace('.', ',')}`;
}

// Best-effort, same pattern as notifyPaymentConfirmedWhatsApp: a push failure
// never fails the webhook. Fires for every confirmed charge, including
// monthly renewals, since every payment event (first sale or renewal) reaches
// this same code path. Dead subscriptions (uninstalled PWA, expired token)
// come back as 404/410 from the push service and get pruned so future sales
// don't keep re-attempting them.
async function notifyAdminsOfSale(supabase: ReturnType<typeof createClient>, value: number, currency: string) {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) return;
  try {
    const { data: subs } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth');
    if (!subs?.length) return;
    const payload = { title: '💰 Nova venda!', body: `${formatMoney(value, currency)} · Ilha do Foco + Aventura das Letras`, url: 'admin.html' };
    await Promise.all(subs.map(async (sub: any) => {
      try {
        await sendWebPush(sub, payload);
      } catch (err) {
        console.error('Push send failed:', (err as Error).message);
        if (/ 404| 410/.test((err as Error).message)) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }));
  } catch (err) {
    console.error('notifyAdminsOfSale failed:', (err as Error).message);
  }
}

// A failed webhook still returns 500, but Asaas' retry window is finite and
// a bug that keeps failing on every retry would otherwise sit unnoticed
// until a customer complains about paying without getting access.
// Best-effort, same pattern as notifyAdminsOfSale.
async function notifyAdminsOfWebhookFailure(supabase: ReturnType<typeof createClient>, eventType: string, errorMessage: string) {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) return;
  try {
    const { data: subs } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth');
    if (!subs?.length) return;
    const payload = { title: '⚠️ Falha no webhook do Asaas', body: `${eventType}: ${errorMessage.slice(0, 120)}`, url: 'admin.html' };
    await Promise.all(subs.map((sub: any) => sendWebPush(sub, payload).catch((err) => console.error('Push send failed:', (err as Error).message))));
  } catch (err) {
    console.error('notifyAdminsOfWebhookFailure failed:', (err as Error).message);
  }
}

// Resolves the buyer's e-mail for the authenticated (non-pending) path, where
// there's no email sitting in externalReference - only used for the Purchase
// CAPI call below, everything else in this flow already works without it.
async function getFamilyEmail(supabase: ReturnType<typeof createClient>, familyId: string): Promise<string | null> {
  const { data: family } = await supabase.from('families').select('auth_user_id').eq('id', familyId).maybeSingle();
  if (!family?.auth_user_id) return null;
  const { data: userData } = await supabase.auth.admin.getUserById(family.auth_user_id as string);
  return userData?.user?.email ?? null;
}

// Files live in the private `kit-pdfs` Storage bucket - kept in sync by hand
// with the identical table in stripe-webhook/index.ts (these two functions
// don't share a module, same pattern as the VAPID/WhatsApp helpers above).
// Asaas only ever runs pt/BRL (see the "Asaas só opera no Brasil" comment
// below), but this keeps the same shape as stripe-webhook's version in case
// that ever changes.
const KIT_PDF_BUCKET = 'kit-pdfs';
type KitInfo = { name: string; files: { label: string; path: string }[] };
const KIT_DELIVERY: Record<string, Record<string, KitInfo>> = {
  kit_mini: {
    pt: {
      name: 'Mini Kit Atenção',
      files: [{ label: 'Mini Kit Atenção', path: 'mini-kit-attenzione-pt.pdf' }],
    },
  },
  kit_completo: {
    pt: {
      name: 'Kit Completo VisCare Kids',
      files: [{ label: 'Kit Completo — 6 módulos', path: 'kit-completo-6-modulos-pt.pdf' }],
    },
  },
  jogos_silabas: {
    pt: {
      name: '100 Jogos de Sons, Sílabas e Palavras',
      files: [{ label: '100 Jogos de Sons, Sílabas e Palavras', path: '100-jogos-sons-silabas-palavras-pt-v2.pdf' }],
    },
  },
  baralho_foco: {
    pt: {
      name: 'Baralho do Foco',
      files: [{ label: 'Baralho do Foco', path: 'baralho-do-foco-pt-v2.pdf' }],
    },
  },
  combo_jogos_baralho: {
    pt: {
      // 2026-08-22: expanded to include Kit Completo (metodo.html-only combo,
      // not the same SKU/price as the standalone kit_completo product) - Mini
      // Kit still arrives separately as the "brinde" bonus (see bonusSku in
      // handleContentKitPayment below), not listed here.
      name: 'Combo: Livro + Baralho do Foco + Kit Completo',
      files: [
        { label: '100 Jogos de Sons, Sílabas e Palavras', path: '100-jogos-sons-silabas-palavras-pt-v2.pdf' },
        { label: 'Baralho do Foco', path: 'baralho-do-foco-pt-v2.pdf' },
        { label: 'Kit Completo — 6 módulos', path: 'kit-completo-6-modulos-pt.pdf' },
      ],
    },
  },
  // _pro variants (2026-08-22): same PDF files as the plain SKUs above, just
  // repositioned + priced for profissionais.html - see checkout.js's
  // KIT_PLANS comment for why. it buyers go through stripe-webhook instead
  // (its own KIT_DELIVERY has the matching it entries).
  jogos_silabas_pro: {
    pt: {
      name: '100 Jogos de Sons, Sílabas e Palavras',
      files: [{ label: '100 Jogos de Sons, Sílabas e Palavras', path: '100-jogos-sons-silabas-palavras-pt-v2.pdf' }],
    },
  },
  baralho_foco_pro: {
    pt: {
      name: 'Baralho do Foco',
      files: [{ label: 'Baralho do Foco', path: 'baralho-do-foco-pt-v2.pdf' }],
    },
  },
  combo_jogos_baralho_pro: {
    pt: {
      name: 'Combo: Livro + Baralho do Foco',
      files: [
        { label: '100 Jogos de Sons, Sílabas e Palavras', path: '100-jogos-sons-silabas-palavras-pt-v2.pdf' },
        { label: 'Baralho do Foco', path: 'baralho-do-foco-pt-v2.pdf' },
      ],
    },
  },
  pare_de_repetir: {
    pt: {
      name: 'Pare de Repetir — 100 Comandos Visuais',
      files: [{ label: 'Pare de Repetir — 100 Comandos Visuais', path: 'pare-de-repetir-pt.pdf' }],
    },
  },
  pare_de_repetir_pro: {
    pt: {
      name: 'Pare de Repetir — 100 Comandos Visuais',
      files: [{ label: 'Pare de Repetir — 100 Comandos Visuais', path: 'pare-de-repetir-pt.pdf' }],
    },
  },
  // digital_pack is never sold on its own - only as a paid order-bump addon
  // on pare_de_repetir (see checkout.js's ADDON_CONFIG) - the 'dp' short
  // code below is what actually shows up in a purchased sku list.
  digital_pack: {
    pt: {
      name: 'Pacote Digital de Comandos (100 imagens)',
      files: [{ label: 'Pacote Digital (100 imagens)', path: 'pare-de-repetir-comandos-digitais.zip' }],
    },
  },
};

// Order-bump add-ons (2026-08-22) are packed into externalReference under
// short codes instead of their full sku names, to stay under Asaas's
// 100-char externalReference limit (see create-public-pix-payment's
// buildExternalReference comment) - aliased onto the same KIT_DELIVERY
// entries here so handleContentKitPayment's sku lookup works unchanged
// whether it sees 'baralho_foco' (standalone purchase) or 'bf' (order-bump
// add-on on a jogos_silabas purchase).
KIT_DELIVERY.bf = KIT_DELIVERY.baralho_foco;
KIT_DELIVERY.kc = KIT_DELIVERY.kit_completo;
KIT_DELIVERY.km = KIT_DELIVERY.kit_mini;
KIT_DELIVERY.dp = KIT_DELIVERY.digital_pack;

const KIT_EMAIL_COPY = {
  pt: { greeting: 'Oi!', thanks: (name: string) => `Obrigada por comprar <b>${name}</b> 🎉 Aqui estão seus arquivos, prontos pra baixar e imprimir:`, expiry: 'Cada link fica válido por 30 dias. Se expirar, é só escrever pra gente que mandamos um novo.', subject: (name: string) => `${name} está pronto pra você!`, bonusLabel: '🎁 De brinde' },
};

// Signed links, not a public bucket - the kit is paid content, not meant to
// be redistributed by URL. 30 days is generous enough for the buyer to get
// to it without leaving the link usable indefinitely if it ever leaks.
//
// `skus` is every sku actually paid for in this one payment - a single
// standalone purchase (all existing plans) just passes a 1-element array,
// an order-bump purchase (jogos_silabas + baralho_foco/kit_completo) passes
// 2-3. `bonusSku`, when given, appends a second kit's files to the same
// email as a FREE gift (the kit_completo -> kit_mini "brinde", same as
// stripe-webhook) - kept separate from `skus` because a bonus is framed
// differently in the email (see copy.bonusLabel below) than a paid add-on,
// which is just another purchased item in the list. Fetched best-effort: a
// missing/not-yet-uploaded bonus file must never block delivery of what was
// actually paid for.
async function sendKitDeliveryEmail(supabase: ReturnType<typeof createClient>, to: string, skus: string[], bonusSku?: string) {
  const kits = skus.map((s) => KIT_DELIVERY[s]?.pt).filter((k): k is NonNullable<typeof k> => Boolean(k));
  if (!kits.length) throw new Error(`sendKitDeliveryEmail: no known product_sku among "${skus.join('+')}"`);
  const copy = KIT_EMAIL_COPY.pt;

  const links: { label: string; url: string }[] = [];
  for (const kit of kits) {
    const kitLinks = await Promise.all(kit.files.map(async (f) => {
      const { data, error } = await supabase.storage.from(KIT_PDF_BUCKET).createSignedUrl(f.path, 60 * 60 * 24 * 30);
      if (error) throw new Error(`createSignedUrl failed for ${f.path}: ${error.message}`);
      return { label: f.label, url: data.signedUrl };
    }));
    links.push(...kitLinks);
  }

  if (bonusSku) {
    const bonusKit = KIT_DELIVERY[bonusSku]?.pt;
    if (bonusKit) {
      try {
        const bonusLinks = await Promise.all(bonusKit.files.map(async (f) => {
          const { data, error } = await supabase.storage.from(KIT_PDF_BUCKET).createSignedUrl(f.path, 60 * 60 * 24 * 30);
          if (error) throw new Error(`createSignedUrl failed for ${f.path}: ${error.message}`);
          return { label: `${copy.bonusLabel} — ${f.label}`, url: data.signedUrl };
        }));
        links.push(...bonusLinks);
      } catch (err) {
        console.error('Bonus kit delivery skipped (file likely not uploaded yet):', (err as Error).message);
      }
    }
  }

  // A standalone purchase has one kit, so this reads exactly as before; an
  // order-bump purchase joins all purchased names (e.g. "100 Jogos de Sons,
  // Sílabas e Palavras + Baralho do Foco") for the subject/greeting.
  const combinedName = kits.map((k) => k.name).join(' + ');

  const listHtml = links.map((l) =>
    `<p style="text-align:center; margin-top:14px;"><a href="${l.url}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">${l.label}</a></p>`
  ).join('');

  // digital_pack ('dp' short code) is the Pare de Repetir order-bump that
  // unlocks the searchable phone app (pare-de-repetir-app.html, deployed at
  // /pare-de-repetir) instead of/alongside the zip file - the app is gated
  // behind a per-purchase code (content_access_codes + check-access-code),
  // never a shared secret, so one leaked code is revocable on its own.
  let appAccessHtml = '';
  if (skus.includes('dp') || skus.includes('digital_pack')) {
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();
    const { error: codeError } = await supabase.from('content_access_codes').insert({ code, sku: 'pare_de_repetir', email: to });
    if (codeError) {
      console.error('Failed to create app access code (app link omitted from e-mail):', codeError.message);
    } else {
      appAccessHtml = `
      <div style="margin-top:20px; padding:18px; background:#F0E6D6; border-radius:14px; text-align:center;">
        <p style="margin:0 0 10px; font-weight:700;">📱 Prefere ver no celular?</p>
        <p style="margin:0 0 12px; font-size:13.5px;">Acesse <a href="https://www.viscarekids.com/pare-de-repetir" style="color:#B5713B; font-weight:700;">viscarekids.com/pare-de-repetir</a> e use o código de acesso:</p>
        <p style="margin:0; font-size:20px; font-weight:800; letter-spacing:2px; font-family:monospace;">${code}</p>
      </div>`;
    }
  }

  const html = `<!DOCTYPE html><html><body style="font-family:'Plus Jakarta Sans',Arial,sans-serif; background:#F6EFDF; color:#1B2621; margin:0; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:#FFFDF7; border-radius:18px; padding:28px 26px;">
      <p>${copy.greeting}</p>
      <p>${copy.thanks(combinedName)}</p>
      ${listHtml}
      ${appAccessHtml}
      <p style="font-size:12px; color:#8A8067; margin-top:20px;">${copy.expiry}</p>
    </div>
  </body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject: copy.subject(combinedName), html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

async function sendMagicLinkEmail(to: string, actionLink: string) {
  const html = `<!DOCTYPE html><html><body style="font-family:'Plus Jakarta Sans',Arial,sans-serif; background:#F6EFDF; color:#1B2621; margin:0; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:#FFFDF7; border-radius:18px; padding:28px 26px;">
      <p>Oi!</p>
      <p>Seu pagamento foi confirmado 🎉 Clique no botão abaixo pra acessar sua conta na Ilha do Foco + Aventura das Letras, já com tudo liberado:</p>
      <p style="text-align:center; margin-top:20px;"><a href="${actionLink}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Acessar minha conta</a></p>
      <p style="font-size:12px; color:#8A8067; margin-top:20px;">Se o botão não funcionar, copie e cole este link no navegador: ${actionLink}</p>
      <p style="font-size:12px; color:#8A8067; margin-top:12px;">Não encontrou este e-mail na caixa de entrada? Confira também a caixa de spam ou lixo eletrônico.</p>
    </div>
  </body></html>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject: 'Seu acesso à Ilha do Foco está liberado', html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

// Used only by the new pending:<email>|<leadId> (public checkout) path: finds-or-creates
// the auth user for this email via a magic link (generateLink transparently
// creates the user if it doesn't exist yet), finds-or-creates their family.
// Split from provisionAccountAndNotify below so check-pix-payment-status's fast
// path (redirects the same browser tab straight in) can reuse this without
// also sending an email - the email stays the fallback for anyone who leaves.
async function provisionAccount(supabase: ReturnType<typeof createClient>, email: string): Promise<{ familyId: string; actionLink: string }> {
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: APP_ORIGIN },
  });
  if (linkError) throw linkError;
  const userId = linkData.user.id;

  const { data: existingFamily } = await supabase.from('families').select('id').eq('auth_user_id', userId).maybeSingle();
  let familyId = existingFamily?.id as string | undefined;
  if (!familyId) {
    const { data: newFamily, error: famError } = await supabase.from('families').insert({ auth_user_id: userId }).select('id').single();
    if (famError) throw famError;
    familyId = newFamily.id;
  }
  return { familyId, actionLink: linkData.properties.action_link };
}

async function provisionAccountAndNotify(supabase: ReturnType<typeof createClient>, email: string): Promise<string> {
  const { familyId, actionLink } = await provisionAccount(supabase, email);
  await sendMagicLinkEmail(email, actionLink);
  return familyId;
}

// Same named-parameter WhatsApp Cloud API call process-funnel-sequence uses.
async function sendWhatsAppTemplate(toRaw: string, templateName: string, lang: string, params: { name: string; value: string }[]) {
  const to = toRaw.replace(/\D/g, '');
  const languageCode = lang === 'it' ? 'it' : 'pt_BR';
  const res = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [{
          type: 'body',
          parameters: params.map((p) => ({ type: 'text', parameter_name: p.name, text: p.value })),
        }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp error ${res.status}: ${await res.text()}`);
}

// Only fires when this payment is linked to a lead that has WhatsApp opt-in,
// a phone number, and a child's name on file (all three required by the
// template) - i.e. only for customers who came through the quiz funnel with
// tracking intact. Everyone else still gets the magic-link e-mail above;
// this is a bonus channel, never the only confirmation sent, so any failure
// here is logged and swallowed rather than blocking the webhook.
async function notifyPaymentConfirmedWhatsApp(supabase: ReturnType<typeof createClient>, leadId: string | null | undefined) {
  if (!leadId) return;
  const { data: lead } = await supabase.from('leads')
    .select('full_name, child_name, contact_whatsapp, whatsapp_opt_in, language')
    .eq('id', leadId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const l = lead as any;
  if (!l || !l.whatsapp_opt_in || !l.contact_whatsapp || !l.child_name) return;
  try {
    await sendWhatsAppTemplate(l.contact_whatsapp, 'kapi_pagamento_confirmado', l.language, [
      { name: 'primeiro_nome', value: firstName(l.full_name) },
      { name: 'nome_crianca', value: firstName(l.child_name) },
    ]);
  } catch (err) {
    console.error('kapi_pagamento_confirmado send failed:', (err as Error).message);
  }
}

// Content kit (printable activities, no game login) - mirrors
// handleContentKitCheckoutCompleted in stripe-webhook/index.ts. Deliberately
// does not touch `subscriptions`/`families`, since a kit buyer hasn't bought
// game access - records the sale on the lead (funnel measurement), delivers
// the actual purchased file(s) by e-mail, and fires the same ad-attribution/
// admin-notification side effects a game sale gets. ref format:
// content_kit:<sku>:<email>|<leadId>|<fbc>|<fbp>.
async function handleContentKitPayment(supabase: ReturnType<typeof createClient>, payment: any, ref: string) {
  const withoutPrefix = ref.slice('content_kit:'.length);
  const colonIdx = withoutPrefix.indexOf(':');
  const sku = withoutPrefix.slice(0, colonIdx);
  // sku may be a single plan (unchanged path) or a '+'-joined list from an
  // order-bump purchase (jogos_silabas+baralho_foco, see
  // create-public-pix-payment's combinedSku) - a plain single sku just
  // yields a 1-element array here, so every existing plan is unaffected.
  const skus = sku.split('+');
  const [email, leadId, fbc, fbp] = withoutPrefix.slice(colonIdx + 1).split('|');
  const value = typeof payment.value === 'number' ? payment.value : 0;

  if (leadId) {
    const { error: eventError } = await supabase.from('lead_events').insert({
      lead_id: leadId,
      event_type: 'converted',
      channel: 'site',
      metadata: { product_sku: sku, amount: value, currency: 'BRL', payment_id: payment.id },
    });
    if (eventError) console.error('Failed to insert lead_events for kit purchase:', eventError.message);

    const { error: leadError } = await supabase.from('leads')
      .update({ funnel_stage: 'cliente' })
      .eq('id', leadId);
    if (leadError) console.error('Failed to mark lead as converted (kit):', leadError.message);
  }

  // Delivery is the actual product being paid for - let a failure here throw
  // (Asaas retries the webhook) instead of silently taking payment and
  // sending nothing. Every Asaas purchase is pt/BRL, matching sendKitDeliveryEmail's
  // only defined language here. kit_completo's Mini Kit "brinde" was removed
  // for pt (2026-08-22, alongside its price drop - it/Stripe keeps it). The
  // combo (100 Jogos + Baralho do Foco) gets its own separate Mini Kit
  // "brinde" instead (2026-08-22 decision), same price, no PDF change beyond
  // the added bonus file.
  if (email) {
    const bonusSku = skus.length === 1 && skus[0] === 'combo_jogos_baralho' ? 'kit_mini' : undefined;
    await sendKitDeliveryEmail(supabase, email, skus, bonusSku);
  }

  if (email && value) {
    await sendPurchaseCapi(`purchase_${payment.id}`, email, value, 'BRL', { fbc: fbc || undefined, fbp: fbp || undefined });
  }
  if (value) {
    await notifyAdminsOfSale(supabase, value, 'BRL');
  }
}

// externalReference is set on the Asaas subscription (or, for the one-time
// 30-day pass, directly on the payment) at creation time and, per Asaas's own
// behavior, propagates to every payment it generates - so the common case
// reads it straight off the webhook payload with no extra call. If it's ever
// missing, fall back to fetching the subscription itself to resolve it.
// Anything that isn't a recognized 'pending:'/'content_kit:' prefix must be a
// valid family UUID (the authenticated-renewal case) - a stray/garbage
// reference (e.g. old diagnostic test data) must never reach a family_id
// lookup as a raw string: Postgres rejects a non-UUID value for a uuid
// column, which used to throw uncaught and 500 the whole webhook - Asaas
// retries a failing delivery repeatedly and eventually penalizes/pauses the
// entire webhook queue after enough failures, silently stopping real
// customer payments from being processed too. Found 2026-08-20 via a
// penalized webhook queue caused by exactly this, from a leftover test payment.
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function resolveExternalReference(payment: any): Promise<string | null> {
  if (payment.externalReference) return payment.externalReference;
  if (!payment.subscription) return null;
  try {
    const res = await fetch(`${ASAAS_API_URL}/subscriptions/${payment.subscription}`, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'IlhaDoFoco',
        'access_token': Deno.env.get('ASAAS_API_KEY') as string,
      },
    });
    const sub = await res.json();
    return sub.externalReference ?? null;
  } catch (err) {
    console.error('resolveExternalReference: failed to fetch subscription', err);
    return null;
  }
}

Deno.serve(async (req) => {
  const token = req.headers.get('asaas-access-token');
  if (!token || token !== Deno.env.get('ASAAS_WEBHOOK_TOKEN')) {
    return new Response('Invalid webhook token', { status: 401 });
  }

  const body = await req.json();
  const event = body.event as string;
  const payment = body.payment;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
  );

  try {
    if (!payment) {
      // Events we don't act on (e.g. non-payment event types) still 200 so
      // Asaas doesn't keep retrying delivery of something we intentionally ignore.
      return new Response('OK (ignored)', { status: 200 });
    }

    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      let familyId: string | null = null;
      let linkedLeadId: string | null = null;
      let purchaseEmail: string | null = null;
      let purchaseFbc: string | null = null;
      let purchaseFbp: string | null = null;
      // Card subscription via Asaas Checkout (create-public-asaas-checkout,
      // 2026-08-20): externalReference doesn't propagate for Checkout-
      // originated payments (confirmed via a real test transaction), so the
      // mapping lives in asaas_checkouts instead, keyed by checkoutSession.
      // NOTE: this whole branch is unvalidated with a real transaction - see
      // create-public-asaas-checkout's header comment for why.
      const cameFromCardCheckout = !!payment.checkoutSession;
      if (cameFromCardCheckout) {
        const { data: mapping } = await supabase.from('asaas_checkouts')
          .select('pending_email, lead_id, fbc, fbp').eq('id', payment.checkoutSession).maybeSingle();
        if (mapping?.pending_email) {
          purchaseEmail = mapping.pending_email;
          purchaseFbc = mapping.fbc;
          purchaseFbp = mapping.fbp;
          familyId = await provisionAccountAndNotify(supabase, mapping.pending_email);
          if (mapping.lead_id) {
            linkedLeadId = mapping.lead_id;
            const { error: leadError } = await supabase.from('leads')
              .update({ funnel_stage: 'cliente', converted_family_id: familyId })
              .eq('id', mapping.lead_id)
              .not('funnel_stage', 'in', '(cliente,perdido)');
            if (leadError) console.error('Failed to mark pending lead as converted (checkout):', leadError);
          }
        } else {
          console.error(`${event}: no asaas_checkouts mapping for checkoutSession`, payment.checkoutSession);
        }
      } else {
        const ref = await resolveExternalReference(payment);

        // Content kits (printable activities, no game login) must never fall
        // into the game-access logic below - that logic grants 30 days of
        // full premium unconditionally for any resolvable family/pending
        // reference. Checked first and returns early, mirroring
        // stripe-webhook's identical product_type branch (the same class of
        // bug already fixed twice there).
        if (ref?.startsWith('content_kit:')) {
          await handleContentKitPayment(supabase, payment, ref);
          return new Response('OK', { status: 200 });
        }

        if (ref?.startsWith('pending:')) {
          // vendas.html's embedded checkout - no account existed before payment.
          // Format is pending:<email>|<leadId>|<fbc>|<fbp> - leadId/fbc/fbp may
          // be empty if there was none (see create-public-pix-payment).
          const [pendingEmail, pendingLeadId, pendingFbc, pendingFbp] = ref.slice('pending:'.length).split('|');
          purchaseEmail = pendingEmail;
          purchaseFbc = pendingFbc || null;
          purchaseFbp = pendingFbp || null;
          familyId = await provisionAccountAndNotify(supabase, pendingEmail);
          if (pendingLeadId) {
            linkedLeadId = pendingLeadId;
            const { error: leadError } = await supabase.from('leads')
              .update({ funnel_stage: 'cliente', converted_family_id: familyId })
              .eq('id', pendingLeadId)
              .not('funnel_stage', 'in', '(cliente,perdido)');
            if (leadError) console.error('Failed to mark pending lead as converted:', leadError);
          }
        } else if (ref && isUuid(ref)) {
          familyId = ref;
        } else if (ref) {
          console.error(`${event}: unrecognized externalReference (not pending:/content_kit:/uuid), ignoring`, ref, payment.id);
        }
      }

      // Last-resort fallback for renewals: if nothing above resolved a
      // family (e.g. a later month's charge on a Checkout-created
      // subscription, where checkoutSession/externalReference behavior on
      // repeat payments is unverified), the first payment already wrote
      // provider_subscription_id into `subscriptions` when it was processed
      // successfully - look the family up by that instead of giving up.
      if (!familyId && payment.subscription) {
        const { data: existingByProviderSub } = await supabase.from('subscriptions')
          .select('family_id').eq('provider_subscription_id', payment.subscription).eq('provider', 'asaas').maybeSingle();
        if (existingByProviderSub?.family_id) familyId = existingByProviderSub.family_id;
      }

      if (familyId) {
        // Checked before the upsert below so the Mini Kit "brinde" (see after
        // the upsert) can tell a brand-new subscription from a monthly renewal -
        // PAYMENT_CONFIRMED/PAYMENT_RECEIVED fires for every renewal too, and
        // the bonus is meant as a one-time welcome gift, not a repeat send.
        const { data: existingSub } = await supabase.from('subscriptions')
          .select('family_id').eq('family_id', familyId).maybeSingle();
        const isFirstEverSubscription = !existingSub;

        // has_premium_access()/family_has_access() now require current_period_end
        // to be either null or in the future. This covers both the recurring
        // monthly Pix subscription (each confirmed payment extends access another
        // 30 days, which is exactly the right semantics for a monthly cycle) and
        // the one-time 30-day pass (same computation, no subscription object
        // involved) - no need to tell the two cases apart here.
        const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        // Asaas só opera no Brasil (PIX/boleto) - moeda sempre BRL, sem ambiguidade
        // (Módulo 13 precisa disso pra casar com o preço certo em `plans`).
        const { error } = await supabase.from('subscriptions').upsert({
          family_id: familyId,
          plan: 'premium',
          status: 'active',
          provider: 'asaas',
          provider_customer_id: payment.customer,
          provider_subscription_id: payment.subscription ?? null,
          current_period_end: currentPeriodEnd,
          currency: 'BRL',
        }, { onConflict: 'family_id' });
        if (error) throw error;

        // Closes the marketing-funnel attribution loop for the authenticated
        // flow, which links converted_family_id on the lead up front (at
        // checkout time) - the pending path already marked its lead above.
        // Selected before the update (not just matched-and-updated in one step)
        // so its id survives for notifyPaymentConfirmedWhatsApp below even
        // though the update itself excludes already-'cliente' rows.
        if (!linkedLeadId) {
          const { data: convertedLead } = await supabase.from('leads')
            .select('id')
            .eq('converted_family_id', familyId)
            .not('funnel_stage', 'in', '(cliente,perdido)')
            .maybeSingle();
          if (convertedLead) {
            linkedLeadId = convertedLead.id;
            const { error: leadError } = await supabase.from('leads')
              .update({ funnel_stage: 'cliente' })
              .eq('id', convertedLead.id);
            if (leadError) console.error('Failed to mark lead as converted:', leadError);
          }
        }
        await notifyPaymentConfirmedWhatsApp(supabase, linkedLeadId);

        // Purchase event for ad optimization - Asaas gives the payment value
        // directly; the authenticated (non-pending) path has no email sitting
        // around, so it's looked up via the family's auth user.
        if (!purchaseEmail) purchaseEmail = await getFamilyEmail(supabase, familyId);

        // Mini Kit "brinde" for new pt (Brazil) subscribers, 2026-08-20 decision -
        // "assina o jogo" means the actual recurring plan (payment.subscription
        // set, or cameFromCardCheckout - Checkout-originated payments are
        // always the recurring card subscription, never the one-time pass),
        // and only on the family's first ever subscription
        // (isFirstEverSubscription, checked above the upsert), not on monthly
        // renewals. Every Asaas payment is already pt/BRL, so no lang check
        // is needed here (unlike stripe-webhook). Best-effort: a subscriber
        // must never see a failed webhook because a bonus PDF isn't uploaded yet.
        if ((payment.subscription || cameFromCardCheckout) && isFirstEverSubscription && purchaseEmail) {
          try {
            await sendKitDeliveryEmail(supabase, purchaseEmail, 'kit_mini');
          } catch (err) {
            console.error('Mini Kit brinde delivery failed (non-blocking):', (err as Error).message);
          }
        }

        if (purchaseEmail && typeof payment.value === 'number') {
          await sendPurchaseCapi(`purchase_${payment.id}`, purchaseEmail, payment.value, 'BRL', {
            fbc: purchaseFbc ?? undefined, fbp: purchaseFbp ?? undefined,
          });
        }

        if (typeof payment.value === 'number') {
          await notifyAdminsOfSale(supabase, payment.value, 'BRL');
        }
      } else {
        console.error(`${event}: could not resolve family_id for payment`, payment.id);
      }
    }

    // Pix has no automatic retry/dunning like card payments: a missed due date
    // (or an explicit delete/refund) means access reverts to free until the
    // family pays the next Pix charge Asaas generates for the subscription.
    if (event === 'PAYMENT_OVERDUE' || event === 'PAYMENT_DELETED' || event === 'PAYMENT_REFUNDED') {
      const ref = await resolveExternalReference(payment);
      let familyId = (ref && !ref.startsWith('pending:') && !ref.startsWith('content_kit:') && isUuid(ref)) ? ref : null;
      // Same fallback as the confirmed-payment branch above: a Checkout-
      // originated card subscription has no usable externalReference, so
      // resolve by the subscription id already on file instead.
      if (!familyId && payment.subscription) {
        const { data: existingByProviderSub } = await supabase.from('subscriptions')
          .select('family_id').eq('provider_subscription_id', payment.subscription).eq('provider', 'asaas').maybeSingle();
        if (existingByProviderSub?.family_id) familyId = existingByProviderSub.family_id;
      }
      if (familyId) {
        const { error } = await supabase.from('subscriptions')
          .update({ plan: 'free', status: 'canceled' })
          .eq('family_id', familyId)
          .eq('provider', 'asaas');
        if (error) throw error;
      } else if (ref) {
        console.error(`${event}: could not resolve family_id for payment`, payment.id);
      }
    }
  } catch (err) {
    console.error(`Error handling ${event}:`, err);
    await notifyAdminsOfWebhookFailure(supabase, event, (err as Error).message);
    return new Response('Internal error handling webhook', { status: 500 });
  }

  return new Response('OK', { status: 200 });
});
