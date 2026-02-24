import { createClient } from '@supabase/supabase-js';

// Access environment variables
const getEnvVar = (_key: string, viteKey: string, fallback: string) => {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[viteKey]) {
        return import.meta.env[viteKey];
    }
    return fallback;
};

// Use the user's existing Supabase project credentials if available
const SUPABASE_URL = getEnvVar('NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL', "https://zbwsbnqqpkvdhqwavjke.supabase.co");
const SUPABASE_ANON_KEY = getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpid3NibnFxcGt2ZGhxd2F2amtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MzgzMzEsImV4cCI6MjA3MjExNDMzMX0.kjhXkXmmNChw0XqYpXehNckMzHPUYX705aNScavKc8g");

// Configure client
export const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
});
