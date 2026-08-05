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
// visitor has no account yet - vendas.html collects only email (+ optional
// phone) + CPF/CNPJ before payment. The Asaas customer/payment's
// externalReference is 'pending:' + email + '|' + leadId (Asaas has no
// generic metadata field, and leadId needs to travel alongside the email so
// both asaas-webhook and check-pix-payment-status's fast path can mark the
// lead converted once paid). asaas-webhook uses the 'pending:' prefix to
// tell this apart from the authenticated flow's family.id reference, and
// only provisions the account once the payment actually confirms.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { email, phone, cpfCnpj, plan, leadId } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const cleanCpfCnpj = String(cpfCnpj || '').replace(/\D/g, '');
    if (!cleanCpfCnpj) {
      return new Response(JSON.stringify({ error: 'missing_cpf' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // bump30 is the same one-time 30-day access as 30days, just offered at a
    // discounted price as an in-checkout upsell (see vendas.html's checkout
    // bump checkbox) instead of the regular avulso price - no recurrence
    // either way, so it shares the 30days branch below, only the value and
    // description differ.
    const isOneTime = plan === '30days' || plan === 'bump30';
    const externalReference = `pending:${email}|${leadId || ''}`;

    // phone is optional and only kept on the Asaas customer record for
    // support/contact reference - not stored anywhere in our own DB.
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : undefined;

    let customerId: string;
    const existing = await asaasFetch(`/customers?externalReference=${encodeURIComponent(externalReference)}&limit=1`);
    if (existing.data?.length) {
      customerId = existing.data[0].id;
    } else {
      const customer = await asaasFetch('/customers', {
        method: 'POST',
        body: JSON.stringify({ name: email, email, cpfCnpj: cleanCpfCnpj, externalReference, ...(cleanPhone ? { mobilePhone: cleanPhone } : {}) }),
      });
      customerId = customer.id;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    let paymentId: string;

    if (isOneTime) {
      const value = plan === 'bump30'
        ? Number(Deno.env.get('ASAAS_BUMP_VALUE_BRL') ?? '24.90')
        : Number(Deno.env.get('ASAAS_ONE_TIME_VALUE_BRL') ?? '34.90');
      const description = plan === 'bump30'
        ? 'Ilha do Foco + Aventura das Letras — Premium (30 dias, oferta especial)'
        : 'Ilha do Foco + Aventura das Letras — Premium (30 dias)';
      const payment = await asaasFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          customer: customerId, billingType: 'PIX', value,
          dueDate: tomorrow.toISOString().slice(0, 10),
          externalReference,
          description,
        }),
      });
      paymentId = payment.id;
    } else {
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
      const foundPaymentId = payments.data?.[0]?.id;
      if (!foundPaymentId) throw new Error('payment_not_found');
      paymentId = foundPaymentId;
    }

    // Best-effort: log checkout_started against the lead now, same as the
    // authenticated flow does client-side - here it's simplest to do it
    // server-side since we already have a service-role-equivalent API key.
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
