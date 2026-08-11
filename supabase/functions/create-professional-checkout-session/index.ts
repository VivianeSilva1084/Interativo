import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Espelha create-checkout-session (famílias), mas pro plano de capacidade do
// profissional (Módulo 14) — só EUR, só cartão, mesmo preço avulso/mensal
// (€9,90), conforme decidido (ver Termos de Uso seção 4). metadata.audience
// = 'professional' é o que diferencia esta sessão no stripe-webhook, que
// precisa resolver professional_subscriptions em vez de subscriptions.
//
// extraChildren (opcional): quantidade de crianças acima das 8 incluídas no
// plano, cobradas a +€3/criança/ciclo via um segundo line_item de
// quantidade variável - um price_id por modo (avulso/mensal), já que o
// Stripe não aceita misturar preço one-time com recorrente na mesma sessão.

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string);
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_ANON_KEY') as string, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Confirma que quem está pagando é mesmo um profissional cadastrado -
    // mesmo padrão de checagem que redeem_invite_code faz do lado do banco,
    // mas aqui é side-effect de dinheiro real, então vale conferir também
    // na Edge Function antes de criar a sessão Stripe.
    const { data: professional } = await supabase.from('professionals').select('id').eq('auth_user_id', user.id).maybeSingle();
    if (!professional) return new Response(JSON.stringify({ error: 'not_a_professional' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { returnUrl, plan, extraChildren } = await req.json();
    const baseUrl = returnUrl || Deno.env.get('APP_URL');
    const is30Days = plan === '30days';
    const priceId = is30Days
      ? Deno.env.get('STRIPE_PRICE_ID_PROFESSIONAL_30DAYS_EUR')
      : Deno.env.get('STRIPE_PRICE_ID_PROFESSIONAL_MONTHLY_EUR');
    if (!priceId) return new Response(JSON.stringify({ error: 'price_not_configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: priceId, quantity: 1 }];
    const extraCount = Number(extraChildren) || 0;
    if (extraCount > 0) {
      // Stripe não deixa misturar preço avulso (one-time) com recorrente na
      // mesma Checkout Session - o item de criança extra precisa existir nos
      // dois modos, cada um com seu próprio price_id, igual ao item base.
      const extraPriceId = is30Days
        ? Deno.env.get('STRIPE_PRICE_ID_PROFESSIONAL_EXTRA_CHILD_30DAYS_EUR')
        : Deno.env.get('STRIPE_PRICE_ID_PROFESSIONAL_EXTRA_CHILD_MONTHLY_EUR');
      if (!extraPriceId) return new Response(JSON.stringify({ error: 'extra_price_not_configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      lineItems.push({ price: extraPriceId, quantity: extraCount });
    }

    const session = await stripe.checkout.sessions.create({
      mode: is30Days ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: `${baseUrl}?checkout=success`, cancel_url: `${baseUrl}?checkout=cancelled`,
      client_reference_id: user.id,
      metadata: { audience: 'professional', supabase_user_id: user.id, professional_id: professional.id, extra_children: String(extraCount) },
    });
    return new Response(JSON.stringify({ url: session.url }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('create-professional-checkout-session error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
