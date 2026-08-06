import { createClient } from 'npm:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') as string;
const FROM_ADDRESS = 'Kapi da Ilha do Foco <kapi@viscaree.com.br>';
const APP_ORIGIN = 'https://www.viscarekids.com';

async function sendMagicLinkEmail(to: string, actionLink: string) {
  const html = `<!DOCTYPE html><html><body style="font-family:'Plus Jakarta Sans',Arial,sans-serif; background:#F6EFDF; color:#1B2621; margin:0; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:#FFFDF7; border-radius:18px; padding:28px 26px;">
      <p>Oi!</p>
      <p>Seu acesso à Ilha do Foco + Aventura das Letras já está liberado 🎉 Clique no botão abaixo pra entrar:</p>
      <p style="text-align:center; margin-top:20px;"><a href="${actionLink}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Acessar minha conta</a></p>
      <p style="font-size:12px; color:#8A8067; margin-top:20px;">Se o botão não funcionar, copie e cole este link no navegador: ${actionLink}</p>
      <p style="font-size:12px; color:#8A8067; margin-top:12px;">Não encontrou este e-mail na caixa de entrada? Confira também a caixa de spam ou lixo eletrônico.</p>
    </div>
  </body></html>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject: 'Seu acesso à Ilha do Foco está liberado', html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

// Manual, admin-only tool: creates (or finds) the account for `email`,
// grants it access via subscriptions.admin_granted_until (checked by
// has_premium_access()/family_has_access() independently of plan/payment),
// and e-mails a magic link so the person can log in. Guarded by the same
// CRON_SECRET already used for process-funnel-sequence's cron auth - this is
// an internal tool invoked directly, not something any client calls.
Deno.serve(async (req) => {
  const adminSecret = req.headers.get('x-admin-secret');
  if (adminSecret !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { email, until } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'missing_email' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const grantedUntil = until || '2099-12-31T23:59:59Z';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
    );

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

    const { error: subError } = await supabase.from('subscriptions').upsert({
      family_id: familyId,
      plan: 'premium',
      status: 'active',
      provider: 'admin',
      admin_granted_until: grantedUntil,
    }, { onConflict: 'family_id' });
    if (subError) throw subError;

    await sendMagicLinkEmail(email, linkData.properties.action_link);

    return new Response(JSON.stringify({ success: true, familyId, grantedUntil }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('admin-grant-access error:', err);
    return new Response(JSON.stringify({ error: 'internal_error', message: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
