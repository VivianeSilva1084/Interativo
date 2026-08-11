import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type AdminTier = 'super_admin' | 'admin';

// Roteador de operações administrativas (Módulo 4, seção 3) — cada ação checa o
// próprio tier do chamador aqui dentro, nunca confia em uma checagem só na UI.
// Nenhuma dessas tabelas (admins/subscriptions/professionals) tem policy de
// escrita para o client autenticado comum — por isso isto roda com a service
// role, gated pelo JWT do chamador + linha real em `admins`.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'missing_authorization_header' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user?.email) {
      return jsonResponse({ error: 'invalid_token' }, 401);
    }

    const { data: adminRow, error: adminError } = await supabase
      .from('admins')
      .select('tier')
      .eq('email', user.email)
      .maybeSingle();
    if (adminError || !adminRow) {
      return jsonResponse({ error: 'not_an_administrator' }, 403);
    }
    const callerTier = adminRow.tier as AdminTier;

    const { action, payload } = await req.json();

    if (action === 'find_family_by_email') {
      // Só super_admin (mesma tela de billing que consome isso é super_admin-only,
      // Módulo 9). Resolve family_id sem o Painel Web precisar da service role.
      if (callerTier !== 'super_admin') {
        return jsonResponse({ error: 'requires_super_admin' }, 403);
      }
      const { email } = payload ?? {};
      if (!email) {
        return jsonResponse({ error: 'missing_email' }, 400);
      }

      const { data, error } = await supabase.rpc('find_family_id_by_email', { p_email: email });
      if (error) throw error;
      const row = data?.[0];
      if (!row) {
        return jsonResponse({ success: true, found: false });
      }

      return jsonResponse({ success: true, found: true, family_id: row.family_id, child_names: row.child_names });
    }

    if (action === 'grant_subscription') {
      if (callerTier !== 'super_admin') {
        return jsonResponse({ error: 'requires_super_admin' }, 403);
      }
      const { family_id, granted_until } = payload ?? {};
      if (!family_id || !granted_until) {
        return jsonResponse({ error: 'missing_family_id_or_granted_until' }, 400);
      }

      const { error } = await supabase
        .from('subscriptions')
        .update({ admin_granted_until: granted_until })
        .eq('family_id', family_id);
      if (error) throw error;

      return jsonResponse({ success: true });
    }

    if (action === 'promote_admin') {
      if (callerTier !== 'super_admin') {
        return jsonResponse({ error: 'requires_super_admin' }, 403);
      }
      const { email, tier } = payload ?? {};
      if (!email || (tier !== 'super_admin' && tier !== 'admin')) {
        return jsonResponse({ error: 'missing_email_or_invalid_tier' }, 400);
      }

      const { error } = await supabase.from('admins').upsert({ email, tier }, { onConflict: 'email' });
      if (error) throw error;

      return jsonResponse({ success: true });
    }

    if (action === 'upsert_development_area') {
      // admin comum também gerencia catálogo (Módulo 4, matriz de autorização, seção 3)
      const { key, name, description, icon } = payload ?? {};
      if (!key || !name) {
        return jsonResponse({ error: 'missing_key_or_name' }, 400);
      }

      const { error } = await supabase
        .from('development_areas')
        .upsert({ key, name, description: description ?? null, icon: icon ?? null }, { onConflict: 'key' });
      if (error) throw error;

      return jsonResponse({ success: true });
    }

    if (action === 'upsert_game') {
      // admin comum também gerencia catálogo (Módulo 4, matriz de autorização, seção 3)
      const {
        key,
        name,
        development_area_key,
        min_age,
        max_age,
        active,
        description,
        skill_tag,
        subactivities,
      } = payload ?? {};
      if (!key || !name || !development_area_key) {
        return jsonResponse({ error: 'missing_key_name_or_development_area_key' }, 400);
      }

      const { data: area, error: areaError } = await supabase
        .from('development_areas')
        .select('id')
        .eq('key', development_area_key)
        .maybeSingle();
      if (areaError) throw areaError;
      if (!area) {
        return jsonResponse({ error: 'unknown_development_area_key' }, 400);
      }

      const { error } = await supabase.from('games').upsert(
        {
          key,
          name,
          development_area_id: area.id,
          min_age: min_age ?? null,
          max_age: max_age ?? null,
          active: active ?? true,
          description: description ?? null,
          skill_tag: skill_tag ?? null,
          subactivities: subactivities ?? null,
        },
        { onConflict: 'key' },
      );
      if (error) throw error;

      return jsonResponse({ success: true });
    }

    if (action === 'upsert_plan') {
      // Só super_admin — preço/receita é dado financeiro sensível (Módulo 13).
      if (callerTier !== 'super_admin') {
        return jsonResponse({ error: 'requires_super_admin' }, 403);
      }
      const { provider, billing_type, price, currency, active, audience } = payload ?? {};
      if (
        (provider !== 'stripe' && provider !== 'asaas') ||
        (billing_type !== 'recurring' && billing_type !== 'one_time') ||
        (currency !== 'BRL' && currency !== 'EUR') ||
        (audience !== undefined && audience !== 'family' && audience !== 'professional')
      ) {
        return jsonResponse({ error: 'invalid_provider_billing_type_or_currency' }, 400);
      }

      const { error } = await supabase.from('plans').upsert(
        {
          provider,
          billing_type,
          price: price ?? null,
          currency,
          audience: audience ?? 'family',
          active: active ?? true,
        },
        { onConflict: 'provider,billing_type,currency,audience' },
      );
      if (error) throw error;

      return jsonResponse({ success: true });
    }

    if (action === 'list_pending_professional_verifications') {
      // Módulo 14 — professionals não tem policy de leitura pro admin comum
      // (só o próprio profissional lê a própria linha), então isto passa
      // pela service role aqui, mesmo padrão das outras actions deste
      // roteador. Qualquer tier de admin pode revisar (mesmo comentário já
      // existente em review_professional_verification, logo abaixo).
      const { data, error } = await supabase
        .from('professionals')
        .select('id, full_name, role, license_number, organization_name, verification_document_path, created_at')
        .eq('verification_status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return jsonResponse({ success: true, professionals: data || [] });
    }

    if (action === 'review_professional_verification') {
      // admin comum também pode aprovar/rejeitar (Módulo 4, matriz de autorização, seção 3)
      const { professional_id, status } = payload ?? {};
      if (!professional_id || (status !== 'verified' && status !== 'rejected')) {
        return jsonResponse({ error: 'missing_professional_id_or_invalid_status' }, 400);
      }

      const { error } = await supabase
        .from('professionals')
        .update({ verification_status: status })
        .eq('id', professional_id);
      if (error) throw error;

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: 'unknown_action' }, 400);
  } catch (error) {
    console.error('admin-operations error:', error);
    return jsonResponse({ error: 'internal_error', message: (error as Error).message }, 500);
  }
});
