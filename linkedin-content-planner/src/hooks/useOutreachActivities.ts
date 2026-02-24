import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { OutreachActivity } from "../types/outreach";
import { toast } from "sonner";

export interface ActivityWithLead extends OutreachActivity {
    outreach_leads?: {
        company: string;
        contact_name: string;
    };
}

export function useOutreachActivities() {
    const [activities, setActivities] = useState<ActivityWithLead[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchActivities = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch activities joined with leads to get name and company
            const { data, error } = await supabase
                .from('outreach_activities')
                .select(`
                    *,
                    outreach_leads (
                        company,
                        contact_name
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setActivities((data as unknown as ActivityWithLead[]) || []);
        } catch (err: any) {
            console.error("Error fetching activities:", err);
            toast.error("Failed to load actions queue");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchActivities();
    }, [fetchActivities]);

    const updateActivityStatus = async (id: string, status: OutreachActivity['status'], additionalUpdates: Partial<OutreachActivity> = {}) => {
        try {
            const updates = {
                status,
                ...additionalUpdates,
                executed_date: status === 'sent' ? new Date().toISOString() : null
            };

            const { error } = await supabase
                .from('outreach_activities')
                .update(updates)
                .eq('id', id);

            if (error) throw error;

            setActivities(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));

            return { error: null };
        } catch (err: any) {
            console.error("Update activity error:", err);
            return { error: err };
        }
    };

    const updateActivity = async (id: string, updates: Partial<OutreachActivity>) => {
        try {
            const { error } = await supabase
                .from('outreach_activities')
                .update(updates)
                .eq('id', id);

            if (error) throw error;

            setActivities(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));

            return { error: null };
        } catch (err: any) {
            console.error("Update activity body/subject error:", err);
            return { error: err };
        }
    };

    return {
        activities,
        loading,
        fetchActivities,
        updateActivityStatus,
        updateActivity
    };
}
