import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string);
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const META_PIXEL_ID = '1359613756236046';
const META_CAPI_ACCESS_TOKEN = Deno.env.get('META_CAPI_ACCESS_TOKEN') as string;
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

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Same event_id formula stripe-webhook uses for its own Purchase CAPI call -
// Meta dedupes both into one event. Best-effort, never blocks this response.
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

// Duplicated from stripe-webhook (same small-duplication pattern already used
// between the Stripe/Asaas webhook pairs in this project) so this fast path
// doesn't depend on the webhook having fired yet.
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

// Public fast-path status check for vendas.html's card checkout, used only on
// landing back at ?checkout=success. Looks the Checkout Session back up in
// Stripe directly (payment_status is already settled by the time Stripe
// redirects back, so this normally resolves on the very first call - no
// polling loop needed like the Pix flow's), runs the same account
// provisioning stripe-webhook does (idempotent), and returns a fresh
// magic-link actionLink so the same tab can redirect straight into an
// authenticated session instead of making the visitor check their e-mail.
// stripe-webhook still fires independently and e-mails that link too, as the
// fallback for anyone who lands here before the webhook has run, or whose
// redirect back from Stripe never completes. Also returns value/currency so
// the client can fire its own Pixel Purchase event right before redirecting.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'missing_session_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return new Response(JSON.stringify({ confirmed: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const value = (session.amount_total ?? 0) / 100;
    const currency = (session.currency || 'brl').toUpperCase();

    const email = session.metadata?.pending_email;
    if (!email) {
      // Not a pending-checkout session (shouldn't happen for this endpoint's
      // only caller) - just report confirmed, no actionLink to give back.
      return new Response(JSON.stringify({ confirmed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
    const { familyId, actionLink } = await provisionAccount(supabase, email);

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
      currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    const { error } = await supabase.from('subscriptions').upsert({
      family_id: familyId,
      plan: 'premium',
      status: 'active',
      provider: 'stripe',
      provider_customer_id: session.customer as string,
      provider_subscription_id: providerSubscriptionId,
      current_period_end: currentPeriodEnd,
    }, { onConflict: 'family_id' });
    if (error) throw error;

    const leadId = session.metadata?.lead_id;
    if (leadId) {
      const { error: leadError } = await supabase.from('leads')
        .update({ funnel_stage: 'cliente', converted_family_id: familyId })
        .eq('id', leadId);
      if (leadError) console.error('Failed to mark lead as converted:', leadError);
    }

    // This endpoint is called directly by the customer's own browser (unlike
    // stripe-webhook, which only sees Stripe's IP/UA), so this is real
    // client_ip_address/client_user_agent for match quality.
    const forwardedFor = req.headers.get('x-forwarded-for');
    const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : undefined;
    const clientUserAgent = req.headers.get('user-agent') ?? undefined;
    await sendPurchaseCapi(`purchase_${session.id}`, email, value, currency, {
      fbc: session.metadata?.fbc, fbp: session.metadata?.fbp, clientIp, clientUserAgent,
    });

    return new Response(JSON.stringify({ confirmed: true, actionLink, value, currency }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('check-checkout-session-status error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
