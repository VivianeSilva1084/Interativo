import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') ?? 'https://api.asaas.com/v3';
// familias.html is the only page that includes checkout.js/handles
// ?checkout=success (vendas.html is Home-only since the 2026-08-13 split).
const RETURN_BASE_URL = 'https://www.viscarekids.com/familias.html';
// 1x1 transparent PNG - Asaas Checkout items require imageBase64.
const PLACEHOLDER_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function asaasFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${ASAAS_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'IlhaDoFoco',
      'access_token': Deno.env.get('ASAAS_API_KEY') as string,
      ...(init.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Asaas API error:', path, JSON.stringify(data));
    throw new Error(data?.errors?.[0]?.description || 'asaas_error');
  }
  return data;
}

// Card path for the recurring monthly subscription (Brazil, 2026-08-20
// decision): create-public-pix-payment's /v3/subscriptions call only accepts
// billingType BOLETO/CREDIT_CARD/PIX (no UNDEFINED), so it can't offer a
// hosted "pick Pix or card yourself" page for a subscription the way the
// one-time flow does. /v3/checkouts DOES support chargeTypes:['RECURRENT'],
// and its hosted page never touches card data on our servers - but unlike a
// direct /v3/payments or /v3/subscriptions call, externalReference does NOT
// propagate to the resulting payment (confirmed with a real test transaction,
// 2026-08-20 - it came back null). asaas_checkouts is the workaround: this
// function writes the buyer's info there keyed by the checkout id, and
// asaas-webhook reads it back via payment.checkoutSession once paid.
//
// NOTE: unlike the one-time UNDEFINED flow, this path has not been validated
// with a real transaction (recurring billing can't be spot-checked the way a
// single payment can - a renewal only happens a month later) - built
// 2026-08-20 per explicit user decision to ship now and verify when possible.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { email, phone, leadId, fbc, fbp } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : undefined;
    const value = Number(Deno.env.get('ASAAS_SUBSCRIPTION_VALUE_BRL') ?? '24.90');

    const checkout = await asaasFetch('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        minutesToExpire: 60,
        callback: {
          successUrl: `${RETURN_BASE_URL}?checkout=success`,
          cancelUrl: `${RETURN_BASE_URL}?checkout=cancelled`,
          autoRedirect: true,
        },
        subscription: { cycle: 'MONTHLY' },
        items: [{
          name: 'Ilha do Foco Premium',
          description: 'Ilha do Foco + Aventura das Letras — assinatura mensal',
          quantity: 1,
          value,
          imageBase64: PLACEHOLDER_IMAGE_BASE64,
        }],
        // Optional - Asaas's own hosted page collects anything missing
        // (including CPF/CNPJ) directly from the customer, same as it does
        // when this is left out entirely.
        customerData: { name: email, email, ...(cleanPhone ? { mobilePhone: cleanPhone } : {}) },
      }),
    });

    const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
    const { error: mapError } = await supabase.from('asaas_checkouts').insert({
      id: checkout.id,
      pending_email: email,
      lead_id: leadId || null,
      fbc: fbc || null,
      fbp: fbp || null,
    });
    // Delivery of the mapping row is the actual mechanism that lets
    // asaas-webhook grant access later - a failure here must not silently
    // let the customer pay for a subscription nobody can ever activate.
    if (mapError) throw mapError;

    if (leadId) {
      const { error: eventError } = await supabase.from('lead_events').insert({ lead_id: leadId, event_type: 'checkout_started', channel: 'site' });
      if (eventError) console.error('Failed to log checkout_started:', eventError);
    }

    return new Response(JSON.stringify({ checkoutUrl: checkout.link }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('create-public-asaas-checkout error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
