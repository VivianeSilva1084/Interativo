import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') as string;
const FROM_ADDRESS = 'Kapi da Ilha do Foco <kapi@viscaree.com.br>';

// "Forgot my code" recovery for the Pare de Repetir app gate
// (pare-de-repetir-app.html) - looks up the most recent non-revoked code
// issued to this e-mail in content_access_codes and re-sends it. Always
// responds with the same generic message regardless of whether an account
// was found, same reasoning as any password-reset flow: don't let an
// anonymous request confirm or deny whether a given e-mail made a purchase.
async function sendCodeEmail(to: string, code: string) {
  const html = `<!DOCTYPE html><html><body style="font-family:'Plus Jakarta Sans',Arial,sans-serif; background:#F6EFDF; color:#1B2621; margin:0; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:#FFFDF7; border-radius:18px; padding:28px 26px;">
      <p>Oi!</p>
      <p>Aqui está seu código de acesso do <b>Pare de Repetir</b>:</p>
      <div style="margin:20px 0; padding:18px; background:#F0E6D6; border-radius:14px; text-align:center;">
        <p style="margin:0; font-size:20px; font-weight:800; letter-spacing:2px; font-family:monospace;">${code}</p>
      </div>
      <p style="text-align:center;"><a href="https://www.viscarekids.com/pare-de-repetir" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Acessar o app</a></p>
    </div>
  </body></html>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject: 'Seu código de acesso — Pare de Repetir', html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const genericResponse = new Response(
    JSON.stringify({ message: 'Se encontrarmos uma compra com esse e-mail, enviamos o código.' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) return genericResponse;

    const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
    const { data, error } = await supabase
      .from('content_access_codes')
      .select('code')
      .ilike('email', email.trim())
      .eq('revoked', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (data) {
      try {
        await sendCodeEmail(email.trim(), data.code);
      } catch (sendErr) {
        console.error('resend-access-code: failed to send e-mail:', (sendErr as Error).message);
      }
    }
    return genericResponse;
  } catch (err) {
    console.error('resend-access-code error:', err);
    return genericResponse;
  }
});
