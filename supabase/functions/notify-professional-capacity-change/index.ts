import { createClient } from 'npm:@supabase/supabase-js@2';

// Consumidor da fila professional_capacity_events (Módulo 14) — chamado por
// pg_cron a cada 15min (registrado manualmente no painel, não via migração
// — ver nota de segurança em 20260810153000_modulo14_profile_suspension_and_notifications.sql).
// Mesmo padrão de e-mail (Resend) e de client Supabase já usado em
// stripe-webhook/index.ts.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') as string;
const FROM_ADDRESS = 'Kapi da Ilha do Foco <kapi@viscaree.com.br>';
const APP_ORIGIN = 'https://interativo-pi.vercel.app';

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

function wrapEmail(bodyHtml: string): string {
  return `<!DOCTYPE html><html><body style="font-family:'Plus Jakarta Sans',Arial,sans-serif; background:#F6EFDF; color:#1B2621; margin:0; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:#FFFDF7; border-radius:18px; padding:28px 26px;">
      ${bodyHtml}
    </div>
  </body></html>`;
}

// deno-lint-ignore no-explicit-any
async function professionalEmail(supabase: ReturnType<typeof createClient>, professionalId: string): Promise<string | null> {
  const { data: professional } = await supabase.from('professionals').select('auth_user_id').eq('id', professionalId).maybeSingle();
  if (!professional) return null;
  const { data } = await supabase.auth.admin.getUserById(professional.auth_user_id as string);
  return data.user?.email ?? null;
}

// deno-lint-ignore no-explicit-any
async function familyEmailForChild(supabase: ReturnType<typeof createClient>, childProfileId: string): Promise<string | null> {
  const { data: child } = await supabase.from('child_profiles').select('family_id').eq('id', childProfileId).maybeSingle();
  if (!child?.family_id) return null; // perfil próprio de profissional não tem família - ver TODO abaixo
  const { data: family } = await supabase.from('families').select('auth_user_id').eq('id', child.family_id).maybeSingle();
  if (!family) return null;
  const { data } = await supabase.auth.admin.getUserById(family.auth_user_id as string);
  return data.user?.email ?? null;
}

async function processEvent(supabase: ReturnType<typeof createClient>, event: any): Promise<void> {
  const profEmail = await professionalEmail(supabase, event.professional_id);

  switch (event.event_type) {
    case 'reminder_1_day_before_expiry': {
      if (!profEmail) return;
      await sendEmail(profEmail, 'Seu acesso profissional vence amanhã',
        wrapEmail(`<p>Oi!</p><p>Sua capacidade paga na Ilha do Foco + Aventura das Letras vence amanhã. Se não renovar, você tem 15 dias de carência pra escolher manualmente quais crianças manter — depois disso, as mais recentes são desativadas automaticamente.</p><p style="text-align:center; margin-top:20px;"><a href="${APP_ORIGIN}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Gerenciar minha capacidade</a></p>`));
      break;
    }
    case 'link_deactivated_lapsed_capacity': {
      const { data: link } = await supabase.from('professional_child_links').select('child_profile_id').eq('id', event.professional_child_link_id).maybeSingle();
      const childId = link?.child_profile_id ?? event.child_profile_id;
      if (profEmail) {
        await sendEmail(profEmail, 'Um vínculo foi desativado por falta de capacidade',
          wrapEmail(`<p>Sua capacidade de acompanhamento venceu há 15 dias sem renovação, e um dos vínculos mais recentes foi desativado automaticamente. O dado não foi apagado — só o seu acesso a ele.</p><p style="text-align:center; margin-top:20px;"><a href="${APP_ORIGIN}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Renovar capacidade</a></p>`));
      }
      const famEmail = childId ? await familyEmailForChild(supabase, childId) : null;
      if (famEmail) {
        await sendEmail(famEmail, 'O vínculo com um profissional foi encerrado',
          wrapEmail(`<p>O vínculo entre o profissional e o perfil do seu filho foi encerrado (capacidade do profissional venceu sem renovação). Nenhum dado foi apagado. Se quiser, você pode convidar o profissional novamente a qualquer momento.</p>`));
      }
      break;
    }
    case 'profile_suspended_lapsed_capacity': {
      // TODO(gap de produto sinalizado no plano técnico): perfil próprio de
      // profissional não tem contato de responsável coletado em nenhum lugar
      // do schema atual, então não há como notificar a família aqui - só o
      // profissional é avisado. Fechar isso exige adicionar esse campo no
      // formulário de criação de perfil próprio (fora do escopo desta migração).
      if (profEmail) {
        await sendEmail(profEmail, 'Um perfil próprio foi suspenso por falta de capacidade',
          wrapEmail(`<p>Sua capacidade paga venceu há 15 dias sem renovação, e um dos perfis próprios mais recentes teve o acesso ao jogo suspenso automaticamente. O dado não foi apagado — renove a capacidade pra reativar.</p><p style="text-align:center; margin-top:20px;"><a href="${APP_ORIGIN}" style="background:#B5713B; color:#fff; text-decoration:none; padding:12px 24px; border-radius:99px; font-weight:700; display:inline-block;">Renovar capacidade</a></p>`));
      }
      break;
    }
    case 'profiles_reactivated': {
      if (!profEmail) return;
      await sendEmail(profEmail, 'Capacidade renovada — acessos reativados',
        wrapEmail(`<p>Sua capacidade foi renovada e reativamos automaticamente os vínculos/perfis mais antigos que couberam no novo limite.</p>`));
      break;
    }
  }
}

Deno.serve(async (req) => {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);

  const { data: events, error } = await supabase
    .from('professional_capacity_events')
    .select('*')
    .is('processed_at', null)
    .limit(50); // lote pequeno - o cron roda a cada 15min, não precisa varrer tudo de uma vez
  if (error) {
    console.error('Failed to load professional_capacity_events:', error.message);
    return new Response('Internal error', { status: 500 });
  }

  const results = { processed: 0, failed: 0 };
  for (const event of events || []) {
    try {
      await processEvent(supabase, event);
      await supabase.from('professional_capacity_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
      results.processed++;
    } catch (err) {
      // Não marca processed_at - próxima execução do cron tenta de novo.
      // Best-effort: um evento com erro persistente fica reprocessando pra
      // sempre até alguém investigar - aceitável na escala atual (poucos
      // eventos), revisitar se isso virar ruído.
      console.error(`Failed to process event ${event.id} (${event.event_type}):`, (err as Error).message);
      results.failed++;
    }
  }

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
