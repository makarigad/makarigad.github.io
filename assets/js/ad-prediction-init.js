/**
 * AD Prediction is a standalone page (no shared header/footer/modals).
 * Publishes the shared Supabase client before inline scripts run loadAll().
 */
import { supabase } from './core-app.js';

window.__mgSupabaseReady = (async () => {
    if (!supabase) throw new Error('Supabase client failed to initialize');
    window.__mgSupabase = supabase;
    return supabase;
})();
