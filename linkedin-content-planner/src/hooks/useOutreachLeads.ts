import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { OutreachLead } from "../types/outreach";
import { toast } from "sonner";

export function useOutreachLeads() {
    const [leads, setLeads] = useState<OutreachLead[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchLeads = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('outreach_leads')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLeads(data as OutreachLead[] || []);
        } catch (err: any) {
            console.error("Error fetching leads:", err);
            toast.error("Failed to load leads");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLeads();
    }, [fetchLeads]);

    const addLead = async (leadData: Partial<OutreachLead>) => {
        try {
            const { data, error } = await supabase
                .from('outreach_leads')
                .insert([leadData])
                .select()
                .single();

            if (error) throw error;
            setLeads(prev => [data as OutreachLead, ...prev]);
            return { data, error: null };
        } catch (err: any) {
            console.error("Add lead error:", err);
            toast.error("Failed to add lead");
            return { data: null, error: err };
        }
    };

    const addMultipleLeads = async (leadsData: Partial<OutreachLead>[]) => {
        try {
            const { data, error } = await supabase
                .from('outreach_leads')
                .insert(leadsData)
                .select();

            if (error) throw error;
            setLeads(prev => [...(data as OutreachLead[]), ...prev]);
            return { data, error: null };
        } catch (err: any) {
            console.error("Bulk import error:", err);
            toast.error("Failed to import leads");
            return { data: null, error: err };
        }
    };

    const updateLead = async (id: string, updates: Partial<OutreachLead>) => {
        try {
            const { data, error } = await supabase
                .from('outreach_leads')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            setLeads(prev => prev.map(l => l.id === id ? (data as OutreachLead) : l));
            return { data, error: null };
        } catch (err: any) {
            console.error("Update lead error:", err);
            toast.error("Failed to update lead");
            return { data: null, error: err };
        }
    };

    const deleteLeads = async (ids: string[]) => {
        try {
            const { error } = await supabase
                .from('outreach_leads')
                .delete()
                .in('id', ids);

            if (error) throw error;
            setLeads(prev => prev.filter(l => !ids.includes(l.id)));
            toast.success(`Deleted ${ids.length} lead(s)`);
        } catch (err: any) {
            console.error("Delete leads error:", err);
            toast.error("Failed to delete leads");
        }
    };

    return {
        leads,
        loading,
        fetchLeads,
        addLead,
        addMultipleLeads,
        updateLead,
        deleteLeads
    };
}
