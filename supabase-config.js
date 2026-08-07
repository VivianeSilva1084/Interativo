// Shared Supabase client credentials for the static pages that use them
// (index.html, admin.html, vendas.html) - previously each file, and inside
// vendas.html each of 3 separate script blocks, hardcoded its own copy of
// the same two strings. This is the public anon key, safe to expose
// client-side by design (RLS is the actual access boundary) - the point of
// this file is not maintaining 5 copies of the same two constants, not
// secrecy. `var` (not const/let) so it attaches to `window` and stays
// reachable as a bare identifier from every later script on the page,
// including the ones inside vendas.html's per-feature IIFEs/functions.
var SUPABASE_URL = 'https://pswmbqlafywaxphsrloe.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzd21icWxhZnl3YXhwaHNybG9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjY2NDIsImV4cCI6MjA5OTUwMjY0Mn0.I1HYF8paNwyP8YE3z496marQW-3y2y1aomFjSZDuh4Q';
