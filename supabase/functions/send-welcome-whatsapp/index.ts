import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_CLOUD_TOKEN') as string;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') as string;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string;
const HOUR = 60 * 60 * 1000;

function firstName(fullName: string) {
  return (fullName || '').trim().split(/\s+/)[0] || fullName;
}

// quiz_profile -> short topic phrase used as {{resultado_quiz}} - same mapping
// process-funnel-sequence uses.
function quizTopic(profile: string | null, lang: string) {
  const map: Record<string, { pt: string; it: string }> = {
    tdah: { pt: 'atenção e impulsividade', it: 'attenzione e impulsività' },
    dislexia: { pt: 'leitura e ortografia', it: 'lettura e ortografia' },
    ambos: { pt: 'atenção e leitura', it: 'attenzione e lettura' },
  };
  const entry = (profile && map[profile]) || { pt: 'o desenvolvimento do seu filho', it: 'lo sviluppo di tuo figlio' };
  return lang === 'it' ? entry.it : entry.pt;
}

async function sendWhatsAppTemplate(toRaw: string, templateName: string, lang: string, params: { name: string; value: string }[]) {
  const to = toRaw.replace(/\D/g, '');
  const languageCode = lang === 'it' ? 'it' : 'pt_BR';
  const res = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [{
          type: 'body',
          parameters: params.map((p) => ({ type: 'text', parameter_name: p.name, text: p.value })),
        }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp error ${res.status}: ${await res.text()}`);
}

async function logEvent(supabase: any, leadId: string, delivered: boolean, metadata: Record<string, unknown>) {
  const eventType = delivered ? 'whatsapp_sent' : 'whatsapp_failed';
  const { error } = await supabase.from('lead_events').insert({ lead_id: leadId, event_type: eventType, channel: 'whatsapp', metadata });
  if (error) console.error('lead_events insert failed:', error.message);
}

// Called directly by the quiz right after a lead is inserted, so the welcome
// WhatsApp (step 0 of the funnel sequence) goes out in seconds instead of
// waiting for process-funnel-sequence's next 10-minute cron tick. That cron
// remains the fallback: it still picks up any lead still at sequence_step 0
// (this call failing, network drop, JS error, etc.), so nothing is lost if
// this call never reaches the server.
//
// Deliberately no 9h-20h send-window check here (unlike steps 1-4, which
// respect it): this message is a direct response to something the person
// just did seconds ago (finishing the quiz), not a cold marketing nudge - if
// someone fills it out at 2am, they're awake and want their result right
// then, same logic as an OTP or order-confirmation message.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { leadId } = await req.json();
    if (!leadId) {
      return new Response(JSON.stringify({ error: 'missing_lead_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);

    // Atomic claim: only proceeds if this lead is still at step 0 (untouched
    // by the cron) - if the update matches zero rows, the cron already got to
    // it first (or it's some other state entirely), so this just no-ops.
    const { data: claimed } = await supabase.from('leads')
      .update({ sequence_step: 1 })
      .eq('id', leadId)
      .eq('sequence_step', 0)
      .select('id, full_name, child_name, contact_whatsapp, whatsapp_opt_in, language, quiz_profile, funnel_stage')
      .maybeSingle();
    if (!claimed) {
      return new Response(JSON.stringify({ sent: false, reason: 'not_at_step_0' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!claimed.whatsapp_opt_in || !claimed.contact_whatsapp) {
      // Nothing to send (no WhatsApp on file) - still advance to step 1's
      // 1-hour delay, same as process-funnel-sequence would have.
      await supabase.from('leads').update({ next_step_at: new Date(Date.now() + HOUR).toISOString() }).eq('id', leadId);
      return new Response(JSON.stringify({ sent: false, reason: 'no_whatsapp_opt_in' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const n = firstName(claimed.full_name);
    const childN = firstName(claimed.child_name) || n;
    let delivered = false;
    let errorMessage: string | undefined;
    try {
      await sendWhatsAppTemplate(claimed.contact_whatsapp, '_kapi_boas_vindas_resultado', claimed.language, [
        { name: 'primeiro_nome', value: n },
        { name: 'nome_crianca', value: childN },
        { name: 'resultado_quiz', value: quizTopic(claimed.quiz_profile, claimed.language) },
      ]);
      delivered = true;
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    const update: Record<string, unknown> = { next_step_at: new Date(Date.now() + HOUR).toISOString() };
    if (delivered && claimed.funnel_stage === 'novo') update.funnel_stage = 'contatado';
    await supabase.from('leads').update(update).eq('id', leadId);
    await logEvent(supabase, leadId, delivered, { step: 0, template: '_kapi_boas_vindas_resultado', ...(errorMessage ? { error: errorMessage } : {}) });

    return new Response(JSON.stringify({ sent: delivered }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('send-welcome-whatsapp error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
