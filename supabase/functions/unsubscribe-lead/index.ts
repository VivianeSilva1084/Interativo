import { createClient } from 'npm:@supabase/supabase-js@2';

function page(lang: string) {
  const isIt = lang === 'it';
  return `<!DOCTYPE html>
<html lang="${isIt ? 'it' : 'pt-BR'}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${isIt ? 'Annullata iscrizione' : 'Inscrição cancelada'}</title>
<style>
  body{ font-family:'Plus Jakarta Sans',Arial,sans-serif; background:#F6EFDF; color:#1B2621; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:20px; text-align:center; }
  .card{ background:#FFFDF7; border-radius:18px; padding:36px 28px; max-width:420px; box-shadow:0 12px 32px rgba(15,61,62,0.14); }
  h1{ font-size:22px; margin:0 0 12px; }
  p{ color:#4A5A52; font-size:15px; line-height:1.5; }
</style></head>
<body><div class="card">
  <div style="font-size:44px; margin-bottom:8px;">\u{1F9AB}</div>
  <h1>${isIt ? 'Iscrizione annullata' : 'Você foi descadastrado(a)'}</h1>
  <p>${isIt ? 'Non riceverai più e-mail da Ilha do Foco. Se hai cambiato idea, puoi sempre tornare a visitare il sito.' : 'Você não vai mais receber e-mails da Ilha do Foco. Se mudar de ideia, é só voltar a visitar o site.'}</p>
</div></body></html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const leadId = url.searchParams.get('lead');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
  );

  let lang = 'pt-BR';
  if (leadId) {
    const { data: lead } = await supabase.from('leads').select('language').eq('id', leadId).maybeSingle();
    if (lead?.language) lang = lead.language;

    const { error } = await supabase.from('leads').update({ email_opt_in: false }).eq('id', leadId);
    if (!error) {
      await supabase.from('lead_events').insert({
        lead_id: leadId, event_type: 'email_unsubscribed', channel: 'email',
      });
    }
  }

  return new Response(page(lang), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
