// Foundational shared state - the Supabase client, the auth/profile object,
// and the current-session tracking bag. Deliberately a leaf module (imports
// nothing) so game-shared.js and, eventually, each game/dashboard module can
// depend on it without any risk of a circular import.
// SUPABASE_URL/SUPABASE_ANON_KEY are set globally by supabase-config.js,
// loaded via its own <script src> tag before dist/app.js in index.html.
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export let state = { lang: navigator.language.startsWith('it') ? 'it' : 'pt', profileId:null, profile:null, familyId:null, familyPinHash:null, authUserId:null, isProfessional:false, isCodeSession:false };

export function getDifficulty(gameKey){ return state.profile.difficultyByGame[gameKey] || 'medio'; }

// Was 5 separate top-level `let` primitives (currentGameKey, sessionDirty,
// sessionSeedsStart, currentSessionId, sessionCompleted) - bundled into one
// object because ES module imports are read-only bindings, so any other
// module that needs to *reassign* one of these (not just read it) cannot do
// `import { currentGameKey } from ...` and then `currentGameKey = x` - it
// has to be a property write on a shared object instead.
export const session = {
  currentGameKey: null,
  sessionDirty: {},
  sessionSeedsStart: {},
  currentSessionId: null,
  sessionCompleted: false,
};
