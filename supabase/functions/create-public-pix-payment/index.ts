import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') ?? 'https://api.asaas.com/v3';

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

// Public counterpart to create-pix-subscription: no auth required, since the
// visitor has no account yet - familias.html collects only email (+ optional
// phone) + CPF/CNPJ before payment. The Asaas customer/payment's
// externalReference is 'pending:' + email + '|' + leadId + '|' + fbc + '|' + fbp
// for game-access plans, or 'content_kit:' + sku + ':' + that same
// email|leadId|fbc|fbp for kit plans (Asaas has no generic metadata field, so
// everything asaas-webhook and check-pix-payment-status need after the
// redirect travels packed into this one string). fbc/fbp let the later
// Purchase CAPI call match this sale back to the ad that drove it - without
// them Meta only gets a hashed e-mail, which isn't enough for ad-level
// attribution. asaas-webhook branches on the 'content_kit:'/'pending:' prefix
// so a kit purchase never falls into the game-access branch that grants
// premium access - the same mistake already fixed twice on the Stripe side.
// jogos_silabas/baralho_foco/combo_jogos_baralho (2026-08-21): metodo.html
// funnel, same content_kit: treatment as kit_mini/kit_completo - printable
// PDF, no game login, must never grant premium access.
const KIT_PLANS = ['kit_mini', 'kit_completo', 'jogos_silabas', 'baralho_foco', 'combo_jogos_baralho'];
// familias.html is the only page that includes checkout.js/handles
// ?checkout=success (vendas.html is Home-only since the 2026-08-13 split).
const RETURN_BASE_URL = 'https://www.viscarekids.com/familias.html';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { email, phone, cpfCnpj, plan, leadId, fbc, fbp } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const cleanCpfCnpj = String(cpfCnpj || '').replace(/\D/g, '');
    if (!cleanCpfCnpj) {
      return new Response(JSON.stringify({ error: 'missing_cpf' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const isKit = KIT_PLANS.includes(plan);
    // bump30 is the same one-time 30-day access as 30days, just offered at a
    // discounted price as an in-checkout upsell (see the checkout bump
    // checkbox) instead of the regular avulso price - no recurrence either
    // way, so it shares the one-time branch below, only value/description differ.
    const isOneTime = plan === '30days' || plan === 'bump30' || isKit;
    // Stable key used only to find-or-reuse the Asaas customer record across
    // repeat checkout attempts - must NOT include fbc/fbp (those change on
    // every visit/click, which would break the lookup and create a duplicate
    // customer each time).
    const customerExternalReference = `pending:${email}|${leadId || ''}`;
    // What actually reaches asaas-webhook/check-pix-payment-status once this
    // specific payment confirms - carries fbc/fbp so the Purchase CAPI call
    // can match the sale back to the ad that drove it, not just a hashed e-mail.
    const externalReference = isKit
      ? `content_kit:${plan}:${email}|${leadId || ''}|${fbc || ''}|${fbp || ''}`
      : `pending:${email}|${leadId || ''}|${fbc || ''}|${fbp || ''}`;

    // phone is optional and only kept on the Asaas customer record for
    // support/contact reference - not stored anywhere in our own DB.
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : undefined;

    let customerId: string;
    const existing = await asaasFetch(`/customers?externalReference=${encodeURIComponent(customerExternalReference)}&limit=1`);
    if (existing.data?.length) {
      customerId = existing.data[0].id;
    } else {
      const customer = await asaasFetch('/customers', {
        method: 'POST',
        body: JSON.stringify({ name: email, email, cpfCnpj: cleanCpfCnpj, externalReference: customerExternalReference, ...(cleanPhone ? { mobilePhone: cleanPhone } : {}) }),
      });
      customerId = customer.id;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (isOneTime) {
      let value: number;
      let description: string;
      if (plan === 'kit_mini') {
        value = Number(Deno.env.get('ASAAS_KIT_MINI_VALUE_BRL') ?? '14.90');
        description = 'Mini Kit Atenção';
      } else if (plan === 'kit_completo') {
        value = Number(Deno.env.get('ASAAS_KIT_COMPLETO_VALUE_BRL') ?? '48.90');
        description = 'Kit Completo VisCare Kids';
      } else if (plan === 'jogos_silabas') {
        value = Number(Deno.env.get('ASAAS_JOGOS_SILABAS_VALUE_BRL') ?? '27.00');
        description = '100 Jogos de Sons, Sílabas e Palavras';
      } else if (plan === 'baralho_foco') {
        value = Number(Deno.env.get('ASAAS_BARALHO_FOCO_VALUE_BRL') ?? '27.00');
        description = 'Baralho do Foco — 60 Missões de Atenção';
      } else if (plan === 'combo_jogos_baralho') {
        value = Number(Deno.env.get('ASAAS_COMBO_JOGOS_BARALHO_VALUE_BRL') ?? '47.00');
        description = 'Combo: 100 Jogos de Sons, Sílabas e Palavras + Baralho do Foco';
      } else if (plan === 'bump30') {
        value = Number(Deno.env.get('ASAAS_BUMP_VALUE_BRL') ?? '24.90');
        description = 'Ilha do Foco + Aventura das Letras — Premium (30 dias, oferta especial)';
      } else {
        value = Number(Deno.env.get('ASAAS_ONE_TIME_VALUE_BRL') ?? '34.90');
        description = 'Ilha do Foco + Aventura das Letras — Premium (30 dias)';
      }
      // UNDEFINED (not PIX) so Asaas's own hosted invoice page lets the
      // customer pick Pix or Credit Card themselves - confirmed via a real
      // test transaction (2026-08-20) that externalReference still reaches
      // the PAYMENT_RECEIVED webhook unchanged for this billingType, same as
      // it always has for PIX. callback.successUrl brings them back here
      // (vs. the subscription branch below, which stays on the embedded
      // QR/copy-paste flow and never leaves this page).
      const payment = await asaasFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          customer: customerId, billingType: 'UNDEFINED', value,
          dueDate: tomorrow.toISOString().slice(0, 10),
          externalReference,
          description,
          callback: { successUrl: `${RETURN_BASE_URL}?checkout=success`, autoRedirect: true },
        }),
      });

      if (leadId) {
        const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
        const { error: eventError } = await supabase.from('lead_events').insert({ lead_id: leadId, event_type: 'checkout_started', channel: 'site' });
        if (eventError) console.error('Failed to log checkout_started:', eventError);
      }

      return new Response(JSON.stringify({ invoiceUrl: payment.invoiceUrl, paymentId: payment.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Subscription (game access, recurring) - unchanged: Asaas's /subscriptions
    // request schema only accepts BOLETO/CREDIT_CARD/PIX (no UNDEFINED), so
    // this still commits to PIX and shows the embedded QR/copy-paste flow
    // rather than leaving the page. Card-for-subscriptions-via-Asaas is a
    // known follow-up, not solved here - see kit_funil_infoproduto_pending memory.
    const value = Number(Deno.env.get('ASAAS_SUBSCRIPTION_VALUE_BRL') ?? '24.90');
    const subscription = await asaasFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: customerId, billingType: 'PIX', cycle: 'MONTHLY', value,
        nextDueDate: tomorrow.toISOString().slice(0, 10),
        externalReference,
        description: 'Ilha do Foco + Aventura das Letras — Premium',
      }),
    });
    const payments = await asaasFetch(`/payments?subscription=${subscription.id}&limit=1`);
    const paymentId = payments.data?.[0]?.id;
    if (!paymentId) throw new Error('payment_not_found');

    if (leadId) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
      const { error: eventError } = await supabase.from('lead_events').insert({ lead_id: leadId, event_type: 'checkout_started', channel: 'site' });
      if (eventError) console.error('Failed to log checkout_started:', eventError);
    }

    const qrCode = await asaasFetch(`/payments/${paymentId}/pixQrCode`);
    return new Response(JSON.stringify({
      qrCodeImage: qrCode.encodedImage,
      copyPasteCode: qrCode.payload,
      paymentId,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('create-public-pix-payment error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
