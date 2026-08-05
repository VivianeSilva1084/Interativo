import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_CLOUD_TOKEN') as string;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') as string;

function firstName(fullName: string) {
  return (fullName || '').trim().split(/\s+/)[0] || fullName;
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

const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

// Called client-side (index.html) right when a premium clinical report
// actually renders - by either the parent's own dashboard or a linked
// professional's child-detail view (both call this the same way; whichever
// fires first for a given day wins). Capped to once per ~20h per child via
// child_profiles.report_notified_at, since the report has no real "generation
// complete" backend event to hook - it's built client-side and can be
// reopened any number of times. Requires a linked lead (WhatsApp opt-in +
// child's name on file) same as the other WhatsApp notifications - otherwise
// there's simply no phone number to send to.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_ANON_KEY') as string,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { childProfileId } = await req.json();
    if (!childProfileId) {
      return new Response(JSON.stringify({ error: 'missing_child_profile_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
    );

    const { data: child } = await supabase.from('child_profiles')
      .select('id, family_id, report_notified_at')
      .eq('id', childProfileId).maybeSingle();
    if (!child) {
      return new Response(JSON.stringify({ sent: false, reason: 'child_not_found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (child.report_notified_at && Date.now() - new Date(child.report_notified_at).getTime() < TWENTY_HOURS_MS) {
      return new Response(JSON.stringify({ sent: false, reason: 'already_notified_recently' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: byConverted } = await supabase.from('leads')
      .select('full_name, child_name, contact_whatsapp, whatsapp_opt_in, language')
      .eq('converted_family_id', child.family_id).maybeSingle();
    const { data: bySignup } = byConverted ? { data: null } : await supabase.from('leads')
      .select('full_name, child_name, contact_whatsapp, whatsapp_opt_in, language')
      .eq('signup_family_id', child.family_id).maybeSingle();
    const lead = byConverted || bySignup;

    if (!lead || !lead.whatsapp_opt_in || !lead.contact_whatsapp || !lead.child_name) {
      return new Response(JSON.stringify({ sent: false, reason: 'no_linked_lead' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    try {
      await sendWhatsAppTemplate(lead.contact_whatsapp, 'kapi_relatorio_pronto', lead.language, [
        { name: 'primeiro_nome', value: firstName(lead.full_name) },
        { name: 'nome_crianca', value: firstName(lead.child_name) },
      ]);
      await supabase.from('child_profiles').update({ report_notified_at: new Date().toISOString() }).eq('id', childProfileId);
      return new Response(JSON.stringify({ sent: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err) {
      console.error('kapi_relatorio_pronto send failed:', (err as Error).message);
      return new Response(JSON.stringify({ sent: false, reason: 'send_failed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (err) {
    console.error('notify-report-ready error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
