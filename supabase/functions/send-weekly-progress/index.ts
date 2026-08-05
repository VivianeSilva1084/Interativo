import { createClient } from 'npm:@supabase/supabase-js@2';

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_CLOUD_TOKEN') as string;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') as string;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string;

function firstName(fullName: string) {
  return (fullName || '').trim().split(/\s+/)[0] || fullName;
}

// Same named-parameter WhatsApp Cloud API call process-funnel-sequence uses.
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

// Weekly marketing nudge (pg_cron, Mondays - see the 'weekly-progress' cron.job
// alongside process-funnel-sequence's). Only reaches families linked to a lead
// with WhatsApp opt-in + a child's name on file (same restriction already used
// for kapi_pagamento_confirmado) - everyone else simply doesn't get this,
// since there's no phone number/child name to send to. Counts sessions across
// BOTH apps together (game_sessions.game_key already includes
// 'aventura_das_letras' alongside the six Ilha do Foco minigames).
Deno.serve(async (req) => {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: sessions, error: sessionsError } = await supabase.from('game_sessions')
    .select('family_id')
    .gte('played_at', sevenDaysAgo);
  if (sessionsError) {
    return new Response(JSON.stringify({ error: sessionsError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const counts: Record<string, number> = {};
  for (const s of sessions || []) {
    // deno-lint-ignore no-explicit-any
    const familyId = (s as any).family_id as string;
    counts[familyId] = (counts[familyId] || 0) + 1;
  }
  const familyIds = Object.keys(counts);

  const results = { sent: 0, failed: 0, skipped: 0, errors: [] as string[] };
  if (familyIds.length === 0) {
    return new Response(JSON.stringify(results, null, 2), { headers: { 'Content-Type': 'application/json' } });
  }

  // Two separate queries (rather than a single .or() built from an id list)
  // to keep this simple and avoid any PostgREST filter-string escaping edge
  // cases; deduped into one lead per family below.
  const leadCols = 'id, full_name, child_name, contact_whatsapp, whatsapp_opt_in, language, converted_family_id, signup_family_id';
  const { data: byConverted } = await supabase.from('leads').select(leadCols).in('converted_family_id', familyIds);
  const { data: bySignup } = await supabase.from('leads').select(leadCols).in('signup_family_id', familyIds);

  const leadByFamily = new Map<string, any>();
  for (const l of [...(byConverted || []), ...(bySignup || [])]) {
    const familyId = (l.converted_family_id || l.signup_family_id) as string;
    if (!leadByFamily.has(familyId)) leadByFamily.set(familyId, l);
  }

  for (const [familyId, lead] of leadByFamily) {
    const sessionsCount = counts[familyId];
    if (!sessionsCount || !lead.whatsapp_opt_in || !lead.contact_whatsapp || !lead.child_name) {
      results.skipped++;
      continue;
    }
    try {
      await sendWhatsAppTemplate(lead.contact_whatsapp, 'kapi_progresso_semanal', lead.language, [
        { name: 'primeiro_nome', value: firstName(lead.full_name) },
        { name: 'nome_crianca', value: firstName(lead.child_name) },
        { name: 'numero_sessoes', value: String(sessionsCount) },
      ]);
      results.sent++;
    } catch (err) {
      results.failed++;
      results.errors.push(`family ${familyId} (lead ${lead.id}): ${(err as Error).message}`);
    }
  }

  return new Response(JSON.stringify(results, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
