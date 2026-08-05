import { createClient } from 'npm:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') as string;
const FROM_ADDRESS = 'Kapi da Ilha do Foco <kapi@viscaree.com.br>';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string;
const SITE_URL = 'https://interativo-pi.vercel.app';
const BEAVER = String.fromCodePoint(0x1F9AB);
const PALM = String.fromCodePoint(0x1F334);
const PLAY = String.fromCodePoint(0x25B6);
const HOUR = 60 * 60 * 1000;

// ---------- small helpers ----------
function esc(s: string) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function firstName(fullName: string) {
  return (fullName || '').trim().split(/\s+/)[0] || fullName;
}
function unsubscribeLink(leadId: string) {
  return `${SUPABASE_URL}/functions/v1/unsubscribe-lead?lead=${leadId}`;
}
function vendasLink(emailContent: 'welcome' | 'lastchance', lang: string, leadId: string, opts?: { video?: boolean }) {
  const base = `${SITE_URL}/vendas.html?utm_source=email&utm_medium=lifecycle&utm_campaign=funil_vendas&utm_content=${emailContent}&lead_id=${leadId}`;
  const hashParts = [];
  if (lang === 'it') hashParts.push('lang=it');
  if (opts?.video) hashParts.push('video=1');
  return hashParts.length ? `${base}#${hashParts.join('&')}` : base;
}
function wrapHtml(bodyHtml: string, leadId: string, lang: string) {
  const unsubLabel = lang === 'it' ? 'Annulla iscrizione' : 'Cancelar inscrição';
  return `<!DOCTYPE html><html><body style="font-family:'Plus Jakarta Sans',Arial,sans-serif; background:#F6EFDF; color:#1B2621; margin:0; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:#FFFDF7; border-radius:18px; padding:28px 26px;">
      ${bodyHtml}
    </div>
    <p style="text-align:center; font-size:11px; color:#8A8067; margin-top:16px;"><a href="${unsubscribeLink(leadId)}" style="color:#8A8067;">${unsubLabel}</a></p>
  </body></html>`;
}

// ---------- e-mail bodies (step 0 -> welcome, step 1 -> last chance) ----------
// The quiz that used to feed this sequence is retired - leads now come from
// vendas.html's own e-mail-only capture form, so nothing here references a
// quiz result anymore.
function emailWelcome(name: string, activeFamilies: number, lang: string, leadId: string) {
  const n = esc(firstName(name));
  const cta = vendasLink('welcome', lang, leadId);
  const videoCta = vendasLink('welcome', lang, leadId, { video: true });
  if (lang === 'it') {
    return {
      subject: `Non sei sola/o in questo, ${n}`,
      html: wrapHtml(`
        <p>Ciao ${n},</p>
        <p>Sono Kapi ${BEAVER} — il capibara che si prende cura di Ilha do Foco.</p>
        <p>Hai lasciato il tuo contatto poco fa, e questo dice già molto: stai cercando un modo per aiutare davvero. Confondere lettere, fatica ad aspettare il proprio turno, distrarsi durante un compito semplice — sono segnali che molti genitori hanno già riconosciuto, e la buona notizia è: c'è una strada.</p>
        <p>Più di ${activeFamilies} famiglie usano già Ilha do Foco per trasformare questi momenti difficili in giochi di pochi minuti, creati con il supporto di logopedisti e psicologi.</p>
        <p><em>"Mio figlio non amava leggere. Dopo due settimane con Aventura das Letras, è lui a chiedere di giocare prima di dormire."</em></p>
        <p><a href="${videoCta}">${PLAY} Guarda: 40 secondi con Kapi</a></p>
        <p>— Kapi</p>
        <p style="text-align:center; margin-top:20px;"><a href="${cta}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Scopri come funziona</a></p>
      `, leadId, lang),
    };
  }
  return {
    subject: `Você não está sozinho(a) nessa, ${n}`,
    html: wrapHtml(`
      <p>Oi ${n},</p>
      <p>Aqui é o Kapi ${BEAVER} — o capivara que cuida da Ilha do Foco.</p>
      <p>Você deixou seu contato agora há pouco, e isso já diz muita coisa: você está procurando um jeito de ajudar de verdade. Trocas de letra, dificuldade de esperar a vez, distração no meio de uma tarefa simples — são sinais que muitos pais já reconheceram, e a boa notícia é: existe caminho.</p>
      <p>Mais de ${activeFamilies} famílias já usam a Ilha do Foco pra transformar esses momentos difíceis em joguinhos de poucos minutos, feitos com apoio de fonoaudiólogos e psicólogos.</p>
      <p><em>"Meu filho não gostava de ler. Depois de duas semanas com o Aventura das Letras, ele mesmo pede pra jogar antes de dormir."</em></p>
      <p><a href="${videoCta}">${PLAY} Assista: 40 segundos com o Kapi</a></p>
      <p>— Kapi</p>
      <p style="text-align:center; margin-top:20px;"><a href="${cta}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Ver como funciona</a></p>
    `, leadId, lang),
  };
}
function emailLastChance(name: string, lang: string, leadId: string) {
  const n = esc(firstName(name));
  const cta = vendasLink('lastchance', lang, leadId);
  if (lang === 'it') {
    return {
      subject: `Ultima occasione, ${n}`,
      html: wrapHtml(`
        <p>Ciao ${n},</p>
        <p>Qualche giorno fa hai lasciato il tuo contatto sull'Isola del Focus — e da allora non abbiamo più tue notizie.</p>
        <p>So che decidere richiede tempo. Ma se quello che ti ha fatto fermare quel giorno è ancora lì — le lettere che si confondono, la pazienza che finisce in fretta, la sensazione di non sapere davvero cosa funziona — questo è il momento di dare un'occhiata più da vicino.</p>
        <p>C'è ancora tempo per garantire l'accesso della tua famiglia.</p>
        <p>— Kapi ${BEAVER}${PALM}</p>
        <p style="text-align:center; margin-top:20px;"><a href="${cta}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Scopri come funziona</a></p>
      `, leadId, lang),
    };
  }
  return {
    subject: `Última chance, ${n}`,
    html: wrapHtml(`
      <p>Oi ${n},</p>
      <p>Alguns dias atrás você deixou seu contato na Ilha do Foco — e desde então não tivemos mais notícias suas.</p>
      <p>Sei que decidir leva tempo. Mas se o que te fez parar naquele dia ainda está aí — as letras que se trocam, a paciência que acaba rápido, a sensação de não saber de fato o que está funcionando — esse é o momento de dar uma olhada mais de perto.</p>
      <p>Ainda dá tempo de garantir o acesso da sua família.</p>
      <p>— Kapi ${BEAVER}${PALM}</p>
      <p style="text-align:center; margin-top:20px;"><a href="${cta}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Ver como funciona</a></p>
    `, leadId, lang),
  };
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

async function logEvent(supabase: any, leadId: string, delivered: boolean, metadata: Record<string, unknown>) {
  const eventType = delivered ? 'email_sent' : 'email_failed';
  const { error } = await supabase.from('lead_events').insert({ lead_id: leadId, event_type: eventType, channel: 'email', metadata });
  if (error) throw new Error(`lead_events insert failed: ${error.message}`);
}

// Two-step e-mail-only sequence (the quiz - and the WhatsApp steps that used
// to run alongside it - is retired; vendas.html's own lead-capture form is
// the only source of leads now). Step 0: welcome, right after capture. Step
// 1: last-chance nudge, 48h later, only reached if the lead hasn't converted
// (the `due` query below already excludes cliente/perdido). No 9h-20h send
// window here - that rule existed specifically for WhatsApp, not e-mail.
Deno.serve(async (req) => {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1';
  const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);

  const results = { sent: 0, failed: 0, skipped: 0, errors: [] as string[] };

  const { data: activeSubs } = await supabase.from('subscriptions').select('family_id').eq('status', 'active');
  const activeFamilies = new Set((activeSubs || []).map((s: any) => s.family_id)).size;

  const { data: due } = await supabase.from('leads')
    .select('id, full_name, contact_email, language, funnel_stage, sequence_step, email_opt_in')
    .not('funnel_stage', 'in', '(cliente,perdido)')
    .not('next_step_at', 'is', null)
    .lte('next_step_at', new Date().toISOString());

  for (const lead of due || []) {
    try {
      const step = lead.sequence_step;
      let sent = false;
      let delivered = false;
      let stepLabel = '';
      let nextDelayMs: number | null = null;
      let errorMessage: string | undefined;

      if (step === 0) {
        stepLabel = 'email_boas_vindas'; nextDelayMs = 48 * HOUR;
        if (lead.email_opt_in && lead.contact_email) {
          sent = true;
          if (dryRun) {
            delivered = true;
          } else {
            try {
              const { subject, html } = emailWelcome(lead.full_name, activeFamilies, lead.language, lead.id);
              await sendEmail(lead.contact_email, subject, html);
              delivered = true;
            } catch (sendErr) {
              errorMessage = (sendErr as Error).message;
              results.errors.push(`lead ${lead.id} (step ${step}) email send failed: ${errorMessage}`);
            }
          }
        }
      } else if (step === 1) {
        stepLabel = 'email_ultima_chance'; nextDelayMs = null;
        if (lead.email_opt_in && lead.contact_email) {
          sent = true;
          if (dryRun) {
            delivered = true;
          } else {
            try {
              const { subject, html } = emailLastChance(lead.full_name, lead.language, lead.id);
              await sendEmail(lead.contact_email, subject, html);
              delivered = true;
            } catch (sendErr) {
              errorMessage = (sendErr as Error).message;
              results.errors.push(`lead ${lead.id} (step ${step}) email send failed: ${errorMessage}`);
            }
          }
        }
      } else {
        // Leftover leads from the old 5-step quiz sequence (steps 2-4) simply
        // stop advancing here - that flow is retired, nothing to send them.
        results.skipped++;
        continue;
      }

      if (!dryRun) {
        const update: Record<string, unknown> = {
          sequence_step: step + 1,
          next_step_at: nextDelayMs ? new Date(Date.now() + nextDelayMs).toISOString() : null,
        };
        if (delivered && lead.funnel_stage === 'novo') update.funnel_stage = 'contatado';
        const { error: updateError } = await supabase.from('leads').update(update).eq('id', lead.id);
        if (updateError) throw new Error(`leads update failed: ${updateError.message}`);
        if (sent) {
          await logEvent(supabase, lead.id, delivered, { step, template: stepLabel, ...(errorMessage ? { error: errorMessage } : {}) });
        }
      }
      if (delivered) results.sent++;
      else if (sent) results.failed++;
    } catch (err) {
      results.errors.push(`lead ${lead.id} (step ${lead.sequence_step}): ${(err as Error).message}`);
    }
  }

  return new Response(JSON.stringify({ dryRun, activeFamilies, ...results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
