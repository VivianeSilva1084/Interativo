import Stripe from 'npm:stripe@^22';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string);
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// Public counterpart to create-checkout-session: no auth required, since the
// visitor has no account yet at this point - vendas.html collects only an
// email (+ optional phone, chosen plan) before payment. stripe-webhook tells
// this apart from the authenticated flow by metadata.pending_email being set
// instead of metadata.supabase_user_id, and provisions the account only
// after payment actually confirms.
//
// success_url carries Stripe's {CHECKOUT_SESSION_ID} template var so
// check-checkout-session-status can look the session back up on return and
// redirect the same tab straight into an authenticated session, instead of
// making the visitor go check their e-mail for the webhook's magic link.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { email, phone, country, plan, leadId, fbc, fbp } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const baseUrl = 'https://www.viscarekids.com/vendas.html';
    const isOneTime = plan === '30days' || plan === 'bump30';

    // bump30 is a checkout-only discounted one-time offer (see vendas.html's
    // bump checkbox) - it has no pre-created Stripe Price object like the
    // other plans do, so it's priced inline instead of requiring the user to
    // set up a new Price in the Stripe dashboard just for this.
    let lineItem: Record<string, unknown>;
    if (plan === 'bump30') {
      const bumpValue = Number(Deno.env.get('ASAAS_BUMP_VALUE_BRL') ?? '24.90');
      lineItem = {
        price_data: {
          currency: 'brl',
          unit_amount: Math.round(bumpValue * 100),
          product_data: { name: 'Ilha do Foco + Aventura das Letras — Premium (30 dias, oferta especial)' },
        },
        quantity: 1,
      };
    } else {
      const priceId = isOneTime
        ? (country === 'BR' ? Deno.env.get('STRIPE_PRICE_ID_30DAYS_BRL') : Deno.env.get('STRIPE_PRICE_ID_30DAYS_EUR'))
        : (country === 'BR' ? Deno.env.get('STRIPE_PRICE_ID_BRL') : Deno.env.get('STRIPE_PRICE_ID_EUR'));
      if (!priceId) return new Response(JSON.stringify({ error: 'price_not_configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      lineItem = { price: priceId, quantity: 1 };
    }

    // phone is optional and only kept as metadata for support/contact
    // reference in the Stripe dashboard - not stored anywhere in our own DB.
    // fbc/fbp travel through metadata so stripe-webhook and
    // check-checkout-session-status can attach them to the Purchase CAPI
    // event later - without them Meta only gets a hashed e-mail to match on,
    // which isn't enough to attribute the sale back to a specific ad.
    const metadata: Record<string, string> = { pending_email: email };
    if (leadId) metadata.lead_id = leadId;
    if (phone) metadata.phone = phone;
    if (fbc) metadata.fbc = fbc;
    if (fbp) metadata.fbp = fbp;

    const session = await stripe.checkout.sessions.create({
      mode: isOneTime ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [lineItem as Stripe.Checkout.SessionCreateParams.LineItem],
      success_url: `${baseUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}?checkout=cancelled`,
      metadata,
    });
    return new Response(JSON.stringify({ url: session.url }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('create-public-checkout-session error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
