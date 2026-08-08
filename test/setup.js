// Runs before every test file. session-state.js calls window.supabase.createClient(...)
// at module-load time (not lazily), so any test that imports anything which
// transitively imports session-state.js needs these globals to already exist -
// otherwise the import itself throws before the test body even runs.
// SUPABASE_URL/SUPABASE_ANON_KEY normally come from supabase-config.js's
// <script src> in index.html; window.supabase normally comes from the
// @supabase/supabase-js <script src> loaded just before it.
globalThis.SUPABASE_URL = 'https://test.supabase.co';
globalThis.SUPABASE_ANON_KEY = 'test-anon-key';
window.supabase = { createClient: () => ({}) };
