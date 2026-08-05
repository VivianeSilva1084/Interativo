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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_ANON_KEY') as string,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { cpfCnpj, leadId, plan } = await req.json();
    const cleanCpfCnpj = String(cpfCnpj || '').replace(/\D/g, '');
    if (!cleanCpfCnpj) {
      return new Response(JSON.stringify({ error: 'missing_cpf' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const is30Days = plan === '30days';

    // Service-role client: only used to resolve this user's own family_id
    // server-side (RLS would allow this via the user's own session too, but
    // this avoids depending on select-my-own-family policies being present).
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
    );
    const { data: family, error: familyError } = await serviceClient
      .from('families').select('id').eq('auth_user_id', user.id).single();
    if (familyError || !family) throw new Error('family_not_found');

    // Asaas has no generic metadata field to carry a second id alongside
    // externalReference (already used for family.id), so the lead<->family
    // link is recorded directly in our own DB now; asaas-webhook reverse-looks
    // this up by converted_family_id once the payment actually confirms.
    // Best-effort: never let this block the real checkout from proceeding.
    if (leadId) {
      const { error: leadError } = await serviceClient.from('leads')
        .update({ converted_family_id: family.id })
        .eq('id', leadId);
      if (leadError) console.error('Failed to link lead to family:', leadError);
    }

    // Reuse an existing Asaas customer for this family if this isn't their
    // first Pix attempt (e.g. a previous one expired/was cancelled).
    let customerId: string;
    const existing = await asaasFetch(`/customers?externalReference=${family.id}&limit=1`);
    if (existing.data?.length) {
      customerId = existing.data[0].id;
    } else {
      const customer = await asaasFetch('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: user.email,
          email: user.email,
          cpfCnpj: cleanCpfCnpj,
          externalReference: family.id,
        }),
      });
      customerId = customer.id;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    let paymentId: string;

    if (is30Days) {
      // One-time 30-day pass: a single Asaas payment, not a subscription -
      // no recurring charge, current_period_end (set by asaas-webhook on
      // confirmation) is what actually governs the 30-day access window.
      const value = Number(Deno.env.get('ASAAS_ONE_TIME_VALUE_BRL') ?? '34.90');
      const payment = await asaasFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          customer: customerId,
          billingType: 'PIX',
          value,
          dueDate: tomorrow.toISOString().slice(0, 10),
          externalReference: family.id,
          description: 'Ilha do Foco + Aventura das Letras — Premium (30 dias)',
        }),
      });
      paymentId = payment.id;
    } else {
      const value = Number(Deno.env.get('ASAAS_SUBSCRIPTION_VALUE_BRL') ?? '24.90');
      const subscription = await asaasFetch('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customer: customerId,
          billingType: 'PIX',
          cycle: 'MONTHLY',
          value,
          nextDueDate: tomorrow.toISOString().slice(0, 10),
          externalReference: family.id,
          description: 'Ilha do Foco + Aventura das Letras — Premium',
        }),
      });
      const payments = await asaasFetch(`/payments?subscription=${subscription.id}&limit=1`);
      const foundPaymentId = payments.data?.[0]?.id;
      if (!foundPaymentId) throw new Error('payment_not_found');
      paymentId = foundPaymentId;
    }

    const qrCode = await asaasFetch(`/payments/${paymentId}/pixQrCode`);

    return new Response(JSON.stringify({
      qrCodeImage: qrCode.encodedImage,
      copyPasteCode: qrCode.payload,
      paymentId,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-pix-subscription error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
