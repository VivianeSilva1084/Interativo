import Stripe from 'npm:stripe@^22';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();
  const now = Math.floor(Date.now() / 1000);

  try {
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET') as string,
      300,
      cryptoProvider
    );
    return new Response(JSON.stringify({ ok: true, eventType: event.type, serverNow: now }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      serverNow: now,
      errMessage: err?.message,
    }, null, 2), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
});
