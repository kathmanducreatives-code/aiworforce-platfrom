import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { OutreachSequence } from "../types/outreach";
import { toast } from "sonner";

export function useOutreachSequences() {
    const [sequences, setSequences] = useState<OutreachSequence[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchSequences = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('outreach_sequences')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setSequences(data as OutreachSequence[] || []);
        } catch (err: any) {
            console.error("Error fetching sequences:", err);
            toast.error("Failed to load sequences");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSequences();
    }, [fetchSequences]);

    const saveSequence = async (sequence: OutreachSequence) => {
        try {
            // Check if it exists (dummy id check normally, but let's assume if it has 'new-' it's new)
            const isNew = sequence.id.startsWith('new-');
            const dataToSave = { ...sequence };
            if (isNew) {
                // Remove temporary ID
                // @ts-ignore
                delete dataToSave.id;
            }

            const { data, error } = await supabase
                .from('outreach_sequences')
                .upsert(dataToSave)
                .select()
                .single();

            if (error) throw error;

            if (isNew) {
                setSequences(prev => [data as OutreachSequence, ...prev]);
            } else {
                setSequences(prev => prev.map(s => s.id === sequence.id ? (data as OutreachSequence) : s));
            }
            return { data, error: null };
        } catch (err: any) {
            console.error("Save sequence error:", err);
            toast.error("Failed to save sequence");
            return { data: null, error: err };
        }
    };

    const updateSequenceStatus = async (id: string, status: OutreachSequence['status']) => {
        try {
            const { data, error } = await supabase
                .from('outreach_sequences')
                .update({ status })
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            setSequences(prev => prev.map(s => s.id === id ? (data as OutreachSequence) : s));
            toast.success(`Sequence ${status}`);
        } catch (err: any) {
            console.error("Update sequence status error:", err);
            toast.error("Failed to update status");
        }
    };

    return {
        sequences,
        loading,
        fetchSequences,
        saveSequence,
        updateSequenceStatus
    };
}
