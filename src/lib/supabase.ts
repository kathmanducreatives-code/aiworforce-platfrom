// Re-export the single canonical Supabase client to avoid multiple instances
export { supabase } from '@/integrations/supabase/client';

export const TABLES = {
    CANDIDATE_PROFILES: 'candidate_profiles',
    ICP_SESSIONS: 'icp_lookalike_sessions'
};

export const RPC = {
    BULK_DELETE_SESSIONS: 'bulk_delete_sessions'
};