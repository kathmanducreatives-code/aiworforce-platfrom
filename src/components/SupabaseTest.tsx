import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export const SupabaseTest = () => {
    const [status, setStatus] = useState('Testing...');
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<any[] | null>(null);

    useEffect(() => {
        testConnection();
    }, []);

    const testConnection = async () => {
        try {
            setStatus('Testing connection...');
            setError(null);

            // Test 1: Check connection
            const { data: healthCheck, error: healthError } = await supabase
                .from('candidate_profiles')
                .select('count')
                .limit(1);

            if (healthError) {
                setError(`Connection failed: ${healthError.message}`);
                setStatus('❌ Failed');
                return;
            }

            // Test 2: Fetch all rows
            const { data: allRows, error: fetchError, count } = await supabase
                .from('candidate_profiles')
                .select('*', { count: 'exact' })
                .limit(10);

            if (fetchError) {
                setError(`Query failed: ${fetchError.message}`);
                setStatus('❌ Query Error');
                return;
            }

            setData(allRows);
            setStatus(`✅ Connected - Found ${count} total rows`);

        } catch (err: any) {
            setError(err.message);
            setStatus('❌ Exception');
        }
    };

    // Check generic env vars (Vite/Next)
    const getEnv = (key: string, viteKey: string) => {
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[viteKey]) return import.meta.env[viteKey];
        if (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.[key]) return (globalThis as any).process.env[key];
        return null;
    };

    const url = getEnv('NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL');
    const key = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');

    return (
        <div style={{ padding: 20, background: '#000', color: '#0f0', fontFamily: 'monospace', border: '1px solid #0f0', margin: '20px', borderRadius: '8px' }}>
            <h3 className="text-xl font-bold mb-4">Supabase Connection Test</h3>
            <p>Status: <span className="font-bold">{status}</span></p>
            {error && <p style={{ color: '#f00', fontWeight: 'bold' }}>Error: {error}</p>}
            <div className="mt-4 opacity-50 text-xs">
                <p>URL: {url ? '✅ SET' : '❌ MISSING'} ({url})</p>
                <p>Key: {key ? '✅ SET' : '❌ MISSING'}</p>
            </div>

            {data && (
                <details className="mt-4">
                    <summary className="cursor-pointer hover:text-white">Data Preview ({data.length} rows)</summary>
                    <pre className="mt-2 bg-[#111] p-4 rounded overflow-auto max-h-[300px] text-xs">
                        {JSON.stringify(data, null, 2)}
                    </pre>
                </details>
            )}

            <button
                onClick={testConnection}
                className="mt-4 px-4 py-2 bg-[#0f0] text-black font-bold rounded hover:bg-[#0f0]/80"
            >
                Retry Connection
            </button>
        </div>
    );
};
