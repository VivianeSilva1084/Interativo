import { createClient } from 'npm:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') as string;
const FROM_ADDRESS = 'Kapi da Ilha do Foco <kapi@viscaree.com.br>';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string;
const SITE_URL = 'https://www.viscarekids.com';
const BEAVER = String.fromCodePoint(0x1F9AB);
const PALM = String.fromCodePoint(0x1F334);
const PLAY = String.fromCodePoint(0x25B6);

function esc(s: string) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function firstName(fullName: string) {
  return (fullName || '').trim().split(/\s+/)[0] || fullName;
}
function unsubscribeLink(leadId: string) {
  return `${SUPABASE_URL}/functions/v1/unsubscribe-lead?lead=${leadId}`;
}
// CTAs go to the sales page (not straight to signup) - it already explains
// the platform, shows comparisons/demos/FAQ, and has its own signup button,
// which reduces drop-off for leads who haven't decided yet. #lang=it makes
// the page open pre-switched to Italian for that language's readers.
function vendasLink(emailContent: 'email1' | 'email2', lang: string, opts?: { video?: boolean }) {
  const base = `${SITE_URL}/vendas.html?utm_source=email&utm_medium=lifecycle&utm_campaign=funil_educativo&utm_content=${emailContent}`;
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

function email1(name: string, activeFamilies: number, lang: string, leadId: string) {
  const n = esc(firstName(name));
  const cta = vendasLink('email1', lang);
  const videoCta = vendasLink('email1', lang, { video: true });
  if (lang === 'it') {
    return {
      subject: `Non sei sola/o in questo, ${n}`,
      html: wrapHtml(`
        <p>Ciao ${n},</p>
        <p>Sono Kapi ${BEAVER} — il capibara che si prende cura di Ilha do Foco.</p>
        <p>So che rispondere a quel quiz poco fa può aver smosso qualcosa. Confondere lettere, fatica ad aspettare il proprio turno, distrarsi durante un compito semplice — sono segnali che molti genitori hanno già riconosciuto, e la buona notizia è: c'è una strada.</p>
        <p>Più di ${activeFamilies} famiglie usano già Ilha do Foco per trasformare questi momenti difficili in giochi di pochi minuti, creati con il supporto di logopedisti e psicologi.</p>
        <p><em>"Mio figlio non amava leggere. Dopo due settimane con Aventura das Letras, è lui a chiedere di giocare prima di dormire."</em></p>
        <p><a href="${videoCta}">${PLAY} Guarda: 40 secondi con Kapi</a></p>
        <p>Domani torno con un invito speciale. A presto ${PALM}</p>
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
      <p>Sei que preencher aquele quiz agora há pouco pode ter mexido com algumas coisas. Trocas de letra, dificuldade de esperar a vez, distração no meio de uma tarefa simples — são sinais que muitos pais já reconheceram, e a boa notícia é: existe caminho.</p>
      <p>Mais de ${activeFamilies} famílias já usam a Ilha do Foco pra transformar esses momentos difíceis em joguinhos de poucos minutos, feitos com apoio de fonoaudiólogos e psicólogos.</p>
      <p><em>"Meu filho não gostava de ler. Depois de duas semanas com o Aventura das Letras, ele mesmo pede pra jogar antes de dormir."</em></p>
      <p><a href="${videoCta}">${PLAY} Assista: 40 segundos com o Kapi</a></p>
      <p>Amanhã eu volto com um convite especial. Até lá ${PALM}</p>
      <p>— Kapi</p>
      <p style="text-align:center; margin-top:20px;"><a href="${cta}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Ver como funciona</a></p>
    `, leadId, lang),
  };
}

function email2(name: string, lang: string, leadId: string) {
  const n = esc(firstName(name));
  const cta = vendasLink('email2', lang);
  if (lang === 'it') {
    return {
      subject: `Quello che nessuno ti dice sullo scambiare le lettere leggendo`,
      html: wrapHtml(`
        <p>Ciao ${n},</p>
        <p>Oggi volevo raccontarti una cosa che molti genitori non sanno: confondere "b" con "d", perdere la pazienza a metà di un compito, o sembrare "con la testa altrove" non è sempre mancanza di impegno del bambino — spesso è il cervello che elabora le informazioni in modo diverso, e questo chiede strategia, non rimproveri.</p>
        <p>Tre segnali da osservare con attenzione:</p>
        <ol>
          <li>Invertire lettere o numeri con frequenza, anche dopo i 7 anni</li>
          <li>Vera difficoltà ad aspettare il proprio turno, anche in giochi che il bambino ama</li>
          <li>Forte frustrazione nel cambiare attività, specialmente lasciando uno schermo</li>
        </ol>
        <p>Non si tratta di etichette. Si tratta di capire come tuo figlio impara meglio — ed è esattamente questo che fa Ilha do Foco, con giochi che si adattano al suo ritmo e report che puoi portare anche dal logopedista o dallo psicopedagogista.</p>
        <p><em>"Il report dell'app mi ha aiutato a mostrare a scuola schemi che vedevo a casa ma non sapevo spiegare."</em> — Camila, mamma di Theo, 8 anni</p>
        <p>C'è ancora tempo per iniziare la prova gratuita di 7 giorni.</p>
        <p>— Kapi ${BEAVER}${PALM}</p>
        <p style="text-align:center; margin-top:20px;"><a href="${cta}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Inizia la mia prova gratuita</a></p>
      `, leadId, lang),
    };
  }
  return {
    subject: `O que ninguém te conta sobre trocar letras ao ler`,
    html: wrapHtml(`
      <p>Oi ${n},</p>
      <p>Hoje eu queria te contar uma coisa que muitos pais não sabem: trocar "b" por "d", perder a paciência no meio de uma tarefa, ou parecer "no mundo da lua" nem sempre é falta de esforço da criança — muitas vezes é o cérebro processando a informação de um jeito diferente, e isso pede estratégia, não repreensão.</p>
      <p>Três sinais que valem observar com carinho:</p>
      <ol>
        <li>Inverter letras ou números com frequência, mesmo depois dos 7 anos</li>
        <li>Dificuldade real de esperar a vez, mesmo em brincadeiras que a criança gosta</li>
        <li>Frustração forte ao trocar de atividade, especialmente saindo de uma tela</li>
      </ol>
      <p>Não é sobre rótulo. É sobre entender o jeito que seu filho aprende melhor — e é exatamente isso que a Ilha do Foco faz, com jogos que se adaptam ao ritmo dele e relatórios que você pode até levar pro fonoaudiólogo ou psicopedagogo.</p>
      <p><em>"O relatório do app me ajudou a mostrar pra escola padrões que eu via em casa mas não sabia explicar."</em> — Camila, mãe do Theo, 8 anos</p>
      <p>Ainda dá tempo de começar o teste gratuito de 7 dias.</p>
      <p>— Kapi ${BEAVER}${PALM}</p>
      <p style="text-align:center; margin-top:20px;"><a href="${cta}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Começar meu teste grátis</a></p>
    `, leadId, lang),
  };
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

Deno.serve(async (req) => {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';

  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
  );

  const results = { email1_sent: 0, email2_sent: 0, errors: [] as string[] };

  // [X] in the copy: live count of families with an active subscription.
  const { data: activeSubs } = await supabase.from('subscriptions').select('family_id').eq('status', 'active');
  const activeFamilies = new Set((activeSubs || []).map((s: any) => s.family_id)).size;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Step 0 -> 1: prova social, due 1h after the quiz was completed.
  const { data: dueStep0 } = await supabase.from('leads')
    .select('id, full_name, contact_email, language')
    .eq('sequence_step', 0)
    .eq('email_opt_in', true)
    .not('funnel_stage', 'in', '(cliente,perdido)')
    .not('contact_email', 'is', null)
    .lte('created_at', oneHourAgo);

  for (const lead of dueStep0 || []) {
    try {
      const { subject, html } = email1(lead.full_name, activeFamilies, lead.language, lead.id);
      if (!dryRun) {
        await sendEmail(lead.contact_email, subject, html);
        await supabase.from('leads').update({
          sequence_step: 1,
          next_step_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }).eq('id', lead.id);
        await supabase.from('lead_events').insert({ lead_id: lead.id, event_type: 'email1_sent', channel: 'email' });
      }
      results.email1_sent++;
    } catch (err) {
      results.errors.push(`lead ${lead.id} (email1): ${err.message}`);
    }
  }

  // Step 1 -> 2: educational content + testimonial, due 24h after email 1.
  const { data: dueStep1 } = await supabase.from('leads')
    .select('id, full_name, contact_email, language')
    .eq('sequence_step', 1)
    .eq('email_opt_in', true)
    .not('funnel_stage', 'in', '(cliente,perdido)')
    .not('contact_email', 'is', null)
    .not('next_step_at', 'is', null)
    .lte('next_step_at', new Date().toISOString());

  for (const lead of dueStep1 || []) {
    try {
      const { subject, html } = email2(lead.full_name, lead.language, lead.id);
      if (!dryRun) {
        await sendEmail(lead.contact_email, subject, html);
        await supabase.from('leads').update({ sequence_step: 2, next_step_at: null }).eq('id', lead.id);
        await supabase.from('lead_events').insert({ lead_id: lead.id, event_type: 'email2_sent', channel: 'email' });
      }
      results.email2_sent++;
    } catch (err) {
      results.errors.push(`lead ${lead.id} (email2): ${err.message}`);
    }
  }

  return new Response(JSON.stringify({ dryRun, activeFamilies, ...results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
