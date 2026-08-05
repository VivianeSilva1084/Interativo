import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') ?? 'https://api.asaas.com/v3';
const META_PIXEL_ID = '1359613756236046';
const META_CAPI_ACCESS_TOKEN = Deno.env.get('META_CAPI_ACCESS_TOKEN') as string;
// generateLink has no way to infer where the app actually lives - without an
// explicit redirectTo it falls back to the Supabase project's configured Site
// URL, which here points at a stale, SSO-protected preview deployment instead
// of production. Matches the exact origin index.html's Google login already
// uses (window.location.origin, no trailing slash).
const APP_ORIGIN = 'https://interativo-pi.vercel.app';

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Same event_id formula asaas-webhook uses for its own Purchase CAPI call -
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

// Duplicated from asaas-webhook (same small-duplication pattern already used
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

// Public status check used only by vendas.html's embedded Pix checkout: there's
// no family_id yet to poll subscriptions by (the account only gets provisioned
// by asaas-webhook once the payment actually confirms), so this polls Asaas's
// own payment status directly instead.
//
// Once confirmed, it also runs the same account provisioning asaas-webhook
// does (idempotent - generateLink/find-or-create-family/upsert-subscription
// are all safe to run twice) and returns a fresh magic-link actionLink, so
// vendas.html can redirect the same browser tab straight into an authenticated
// session instead of making the visitor go check their e-mail. asaas-webhook
// still fires independently and e-mails that link too, as the fallback for
// anyone who closes the tab before this resolves. Also returns value/currency
// so the client can fire its own Pixel Purchase event right before redirecting.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { paymentId } = await req.json();
    if (!paymentId) {
      return new Response(JSON.stringify({ error: 'missing_payment_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const res = await fetch(`${ASAAS_API_URL}/payments/${paymentId}`, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'IlhaDoFoco',
        'access_token': Deno.env.get('ASAAS_API_KEY') as string,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.errors?.[0]?.description || 'asaas_error');
    const confirmed = data.status === 'CONFIRMED' || data.status === 'RECEIVED';
    if (!confirmed) {
      return new Response(JSON.stringify({ confirmed: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ref = data.externalReference as string | undefined;
    if (!ref?.startsWith('pending:')) {
      // Not a pending-checkout payment (shouldn't happen for this endpoint's
      // only caller) - just report confirmed, no actionLink to give back.
      return new Response(JSON.stringify({ confirmed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const [email, leadId, fbc, fbp] = ref.slice('pending:'.length).split('|');

    const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
    const { familyId, actionLink } = await provisionAccount(supabase, email);

    const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: subError } = await supabase.from('subscriptions').upsert({
      family_id: familyId,
      plan: 'premium',
      status: 'active',
      provider: 'asaas',
      provider_customer_id: data.customer,
      provider_subscription_id: data.subscription ?? null,
      current_period_end: currentPeriodEnd,
    }, { onConflict: 'family_id' });
    if (subError) throw subError;

    if (leadId) {
      const { error: leadError } = await supabase.from('leads')
        .update({ funnel_stage: 'cliente', converted_family_id: familyId })
        .eq('id', leadId)
        .not('funnel_stage', 'in', '(cliente,perdido)');
      if (leadError) console.error('Failed to mark lead as converted:', leadError);
    }

    // This endpoint is polled directly by the customer's own browser (unlike
    // asaas-webhook, which only sees Asaas's IP/UA), so this is real
    // client_ip_address/client_user_agent for match quality.
    const forwardedFor = req.headers.get('x-forwarded-for');
    const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : undefined;
    const clientUserAgent = req.headers.get('user-agent') ?? undefined;

    const value = typeof data.value === 'number' ? data.value : 0;
    if (value) {
      await sendPurchaseCapi(`purchase_${data.id}`, email, value, 'BRL', { fbc: fbc || undefined, fbp: fbp || undefined, clientIp, clientUserAgent });
    }

    return new Response(JSON.stringify({ confirmed: true, actionLink, value, currency: 'BRL' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('check-pix-payment-status error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
