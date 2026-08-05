import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_ANON_KEY') as string,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { leadId } = await req.json();
    if (!leadId) {
      return new Response(JSON.stringify({ error: 'missing_lead_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Service-role client: leads has no RLS policy letting a regular signed-up
    // user (as opposed to an admin) update their own lead row, by design - this
    // link only happens through this trusted server-side path.
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
    );

    const { data: family, error: familyError } = await serviceClient
      .from('families').select('id').eq('auth_user_id', user.id).single();
    if (familyError || !family) {
      return new Response(JSON.stringify({ error: 'family_not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Only advances funnel_stage forward from novo/contatado - a lead already
    // at trial/cliente/perdido must never be regressed back to 'cadastrado'.
    const { data: updated, error: updateError } = await serviceClient
      .from('leads')
      .update({ signup_family_id: family.id, funnel_stage: 'cadastrado' })
      .eq('id', leadId)
      .in('funnel_stage', ['novo', 'contatado'])
      .select('id');
    if (updateError) throw updateError;

    const { error: eventError } = await serviceClient.from('lead_events').insert({
      lead_id: leadId, event_type: 'signup_completed', channel: 'site',
    });
    if (eventError) throw eventError;

    return new Response(JSON.stringify({ success: true, stageUpdated: (updated?.length ?? 0) > 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('link-lead-signup error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
