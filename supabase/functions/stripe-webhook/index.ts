import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string);
// Deno has no Node `crypto` module, so signature verification needs the Web
// Crypto based provider + the async constructEventAsync (not constructEvent).
const cryptoProvider = Stripe.createSubtleCryptoProvider();
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
// uses (window.location.origin, no trailing slash).
const APP_ORIGIN = 'https://interativo-pi.vercel.app';

function firstName(fullName: string) {
  return (fullName || '').trim().split(/\s+/)[0] || fullName;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Server-side counterpart of the client Pixel Purchase call vendas.html fires
// (see check-checkout-session-status) - same event_id shared between both so
// Meta dedupes them into a single Purchase instead of double-counting. This
// one is the reliable source of truth (fires here regardless of whether the
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
        event_source_url: `${APP_ORIGIN}/vendas.html`,
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
// never fails the webhook. Called both from checkout.session.completed (first
// sale) and invoice.payment_succeeded (renewals) below - dead subscriptions
// (uninstalled PWA, expired token) come back as 404/410 from the push service
// and get pruned so future sales don't keep re-attempting them.
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

// Used only by the new pending_email (public checkout) path: finds-or-creates
// the auth user for this email via a magic link (generateLink transparently
// creates the user if it doesn't exist yet), finds-or-creates their family.
// Split from provisionAccountAndNotify below so check-checkout-session-status's
// fast path (redirects the same browser tab straight in) can reuse this without
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

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  // The raw body (not parsed JSON) is required for signature verification.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET') as string,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Webhook signature invalid', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
  );

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      const pendingEmail = session.metadata?.pending_email;

      let familyId: string | null = null;
      if (userId) {
        const { data: family } = await supabase.from('families').select('id').eq('auth_user_id', userId).single();
        familyId = family?.id ?? null;
      } else if (pendingEmail) {
        // vendas.html's embedded checkout - no account existed before payment.
        familyId = await provisionAccountAndNotify(supabase, pendingEmail);
      }

      if (familyId) {
        // has_premium_access()/family_has_access() now require current_period_end
        // to be either null or in the future, so this must always be set - there's
        // no future webhook event for a one-time payment to fix it up later.
        let currentPeriodEnd: string | null = null;
        let providerSubscriptionId: string | null = null;
        if (session.mode === 'subscription' && session.subscription) {
          providerSubscriptionId = session.subscription as string;
          const sub = await stripe.subscriptions.retrieve(providerSubscriptionId);
          // deno-lint-ignore no-explicit-any
          const subAny = sub as any;
          const periodEndTs = subAny.items?.data?.[0]?.current_period_end ?? subAny.current_period_end;
          if (periodEndTs) currentPeriodEnd = new Date(periodEndTs * 1000).toISOString();
        } else if (session.mode === 'payment') {
          // One-time 30-day pass: no Stripe subscription object exists, so
          // the expiry is just today + 30 days, computed here.
          currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        }

        // currency vem direto do Checkout Session real (Stripe sempre preenche) -
        // usado pelo Módulo 13 para casar com o preço certo em `plans` (BRL vs EUR
        // têm valores reais diferentes, não dá pra estimar sem isso).
        const { error } = await supabase.from('subscriptions').upsert({
          family_id: familyId,
          plan: 'premium',
          status: 'active',
          provider: 'stripe',
          provider_customer_id: session.customer as string,
          provider_subscription_id: providerSubscriptionId,
          current_period_end: currentPeriodEnd,
          currency: (session.currency || 'brl').toUpperCase(),
        }, { onConflict: 'family_id' });
        if (error) throw error;

        // Closes the marketing-funnel attribution loop: if this checkout
        // was reached via a tracked lead link, mark that lead as converted.
        const leadId = session.metadata?.lead_id;
        if (leadId) {
          const { error: leadError } = await supabase.from('leads')
            .update({ funnel_stage: 'cliente', converted_family_id: familyId })
            .eq('id', leadId);
          if (leadError) throw leadError;
        }
        await notifyPaymentConfirmedWhatsApp(supabase, leadId);

        // Purchase event for ad optimization - value/currency straight off the
        // Checkout Session (amount_total is in the smallest currency unit, e.g.
        // cents), email from Stripe's own captured checkout details.
        const purchaseEmail = session.customer_details?.email || pendingEmail;
        const currency = (session.currency || 'brl').toUpperCase();
        if (purchaseEmail) {
          const value = (session.amount_total ?? 0) / 100;
          await sendPurchaseCapi(`purchase_${session.id}`, purchaseEmail, value, currency, { fbc: session.metadata?.fbc, fbp: session.metadata?.fbp });
        }
        if (typeof session.amount_total === 'number') {
          await notifyAdminsOfSale(supabase, session.amount_total / 100, currency);
        }
      }
    }

    // Renewals of a recurring subscription never fire checkout.session.completed
    // again (that only happens once, at initial checkout) - this is the event
    // that actually repeats every billing cycle. billing_reason narrows it to
    // just the renewal charges, so the first payment (already pushed above)
    // doesn't get double-notified.
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.billing_reason === 'subscription_cycle' && typeof invoice.amount_paid === 'number') {
        await notifyAdminsOfSale(supabase, invoice.amount_paid / 100, (invoice.currency || 'brl').toUpperCase());
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const { error } = await supabase.from('subscriptions')
        .update({ plan: 'free', status: 'canceled' })
        .eq('provider_subscription_id', sub.id);
      if (error) throw error;
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription;
      // Stripe's Basil API version (2025-03-31+) moved current_period_end off
      // the subscription and onto each subscription item - read from wherever
      // it actually lives so this doesn't silently break on newer accounts.
      // deno-lint-ignore no-explicit-any
      const subAny = sub as any;
      const periodEndTs = subAny.items?.data?.[0]?.current_period_end ?? subAny.current_period_end;
      const update: Record<string, unknown> = { status: sub.status };
      if (periodEndTs) {
        update.current_period_end = new Date(periodEndTs * 1000).toISOString();
      }
      const { error } = await supabase.from('subscriptions')
        .update(update)
        .eq('provider_subscription_id', sub.id);
      if (error) throw error;
    }
  } catch (err) {
    // Let this surface as a non-2xx so Stripe retries (transient DB hiccups
    // recover on their own); swallowing it would make a real bug invisible.
    console.error(`Error handling ${event.type}:`, err);
    return new Response('Internal error handling webhook', { status: 500 });
  }

  return new Response('OK', { status: 200 });
});
