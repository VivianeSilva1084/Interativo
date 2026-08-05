import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string);
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: {...corsHeaders,'Content-Type':'application/json'} });
    const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_ANON_KEY') as string, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: {...corsHeaders,'Content-Type':'application/json'} });
    const { country, returnUrl, leadId, plan } = await req.json();
    const baseUrl = returnUrl || Deno.env.get('APP_URL');
    const is30Days = plan === '30days';
    const priceId = is30Days
      ? (country === 'BR' ? Deno.env.get('STRIPE_PRICE_ID_30DAYS_BRL') : Deno.env.get('STRIPE_PRICE_ID_30DAYS_EUR'))
      : (country === 'BR' ? Deno.env.get('STRIPE_PRICE_ID_BRL') : Deno.env.get('STRIPE_PRICE_ID_EUR'));
    if (!priceId) return new Response(JSON.stringify({ error: 'price_not_configured' }), { status: 500, headers: {...corsHeaders,'Content-Type':'application/json'} });
    const metadata: Record<string, string> = { supabase_user_id: user.id };
    if (leadId) metadata.lead_id = leadId;
    const session = await stripe.checkout.sessions.create({
      mode: is30Days ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}?checkout=success`, cancel_url: `${baseUrl}?checkout=cancelled`,
      client_reference_id: user.id, metadata,
    });
    return new Response(JSON.stringify({ url: session.url }), { headers: {...corsHeaders,'Content-Type':'application/json'} });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: {...corsHeaders,'Content-Type':'application/json'} });
  }
});
