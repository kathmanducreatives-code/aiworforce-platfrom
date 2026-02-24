import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { toast } from "sonner";

export function useOutreachMetrics() {
    const [metrics, setMetrics] = useState({
        totalLeads: 0,
        messagesSent: 0,
        repliesReceived: 0,
        meetingsBooked: 0,
        pendingCalls: 0,
        pendingOutreach: 0,
        pendingContent: 0, // Mocked for now since Content is elsewhere
        completedCalls: 0,
        completedOutreach: 0,
        completedContent: 0,
    });
    const [loading, setLoading] = useState(true);

    const fetchMetrics = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch total leads
            const { count: totalLeads } = await supabase
                .from('outreach_leads')
                .select('*', { count: 'exact', head: true });

            // Fetch overall activities to calculate sent/replies
            const { data: actions, error: actionsErr } = await supabase
                .from('outreach_activities')
                .select('status, channel, response_received');

            // Fetch leads with meetings
            const { count: meetingsBooked } = await supabase
                .from('outreach_leads')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'meeting_booked');

            if (actionsErr) throw actionsErr;

            const safeActions = actions || [];

            // Stats
            const messagesSent = safeActions.filter(a => a.status === 'sent').length;
            const repliesReceived = safeActions.filter(a => a.response_received).length;

            // Queue calculations today
            const pendingCalls = safeActions.filter(a => a.status === 'pending' && a.channel === 'call').length;
            const pendingOutreach = safeActions.filter(a => a.status === 'pending' && a.channel !== 'call').length;
            const completedCalls = safeActions.filter(a => a.status === 'sent' && a.channel === 'call').length;
            const completedOutreach = safeActions.filter(a => a.status === 'sent' && a.channel !== 'call').length;

            setMetrics({
                totalLeads: totalLeads || 0,
                messagesSent,
                repliesReceived,
                meetingsBooked: meetingsBooked || 0,
                pendingCalls,
                pendingOutreach,
                pendingContent: 2, // Dummy count
                completedCalls,
                completedOutreach,
                completedContent: 1, // Dummy count
            });

        } catch (err: any) {
            console.error("Error fetching metrics:", err);
            toast.error("Failed to load metrics");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchMetrics();
    }, [fetchMetrics]);

    return {
        metrics,
        loading,
        fetchMetrics
    };
}
