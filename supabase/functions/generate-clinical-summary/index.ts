// Deprecated: the clinical summary is now computed deterministically in the
// frontend (buildClinicalSummary in index.html) instead of calling an LLM.
// This function is unused and safe to delete from the dashboard.
Deno.serve(() => new Response('deprecated - unused', { status: 410 }));
