import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface DialerStatus {
    id: string;
    is_active: boolean;
    current_lead_name: string | null;
    current_lead_phone: string | null;
    last_call_sid: string | null;
    last_call_status: string | null;
    total_called_today: number;
    updated_at: string;
}

export function useDialerStatus() {
    const [status, setStatus] = useState<DialerStatus | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Initial fetch
        async function fetchStatus() {
            try {
                const { data, error } = await supabase
                    .from('dialer_status')
                    .select('*')
                    .eq('id', '00000000-0000-0000-0000-000000000001')
                    .single();

                if (error) throw error;
                setStatus(data);
            } catch (err) {
                console.error('Error fetching dialer status:', err);
            } finally {
                setLoading(false);
            }
        }

        fetchStatus();

        // Subscribe to real-time updates
        const channel = supabase
            .channel('dialer-live-status')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'dialer_status',
                    filter: 'id=eq.00000000-0000-0000-0000-000000000001'
                },
                (payload) => {
                    setStatus(payload.new as DialerStatus);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return { status, loading };
}
