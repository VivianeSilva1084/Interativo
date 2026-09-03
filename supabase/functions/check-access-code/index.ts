import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Public check for the Pare de Repetir app's access gate (pare-de-repetir-app.html,
// deployed at /pare-de-repetir) - the client never talks to
// content_access_codes directly (no anon/authenticated RLS policy exists on
// that table), only through this function, using the service role. Keeps a
// leaked/shared code revocable (flip `revoked`) without touching every
// other buyer's code, unlike the old single-hardcoded-hash approach.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { code } = await req.json();
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ valid: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
    const { data, error } = await supabase
      .from('content_access_codes')
      .select('revoked')
      .eq('code', code.trim().toUpperCase())
      .maybeSingle();
    if (error) throw error;
    const valid = !!data && !data.revoked;
    return new Response(JSON.stringify({ valid }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('check-access-code error:', err);
    return new Response(JSON.stringify({ valid: false, error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
