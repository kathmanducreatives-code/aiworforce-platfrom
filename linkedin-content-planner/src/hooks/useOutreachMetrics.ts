import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface OutreachMetrics {
    totalLeads: number;
    hotLeads: number;
    interceptedLeads: number;
    dmsGenerated: number;
    inSequence: number;
    acceptedConnections: number;
    completedOutreach: number;
    pendingOutreach: number;
    completedCalls: number;
    pendingCalls: number;
    completedContent: number;
    pendingContent: number;
    meetingsBooked: number;
    messagesSent: number;
    repliesReceived: number;
    recentActivity: { type: string; name: string; time: string }[];
}

export function useOutreachMetrics() {
    const [metrics, setMetrics] = useState<OutreachMetrics>({
        totalLeads: 0,
        hotLeads: 0,
        interceptedLeads: 0,
        dmsGenerated: 0,
        inSequence: 0,
        acceptedConnections: 0,
        completedOutreach: 0,
        pendingOutreach: 0,
        completedCalls: 0,
        pendingCalls: 0,
        completedContent: 0,
        pendingContent: 0,
        meetingsBooked: 0,
        messagesSent: 0,
        repliesReceived: 0,
        recentActivity: [],
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchMetrics() {
            setLoading(true);
            try {
                const [leadsRes, activitiesRes] = await Promise.all([
                    supabase
                        .from('outreach_leads')
                        .select('id, tier, status, discovery_source, closely_connection_status, contact_name, company, created_at')
                        .order('created_at', { ascending: false })
                        .limit(200),
                    supabase
                        .from('outreach_activities')
                        .select('id, action_type, status, channel, created_at, outreach_leads(contact_name, company)')
                        .order('created_at', { ascending: false })
                        .limit(50), // Increased limit slightly for better metrics accuracy
                ]);

                const leads = leadsRes.data ?? [];
                const activities = activitiesRes.data ?? [];

                const totalLeads = leads.length;
                const hotLeads = leads.filter(l => l.tier === 'tier_1').length;
                const interceptedLeads = leads.filter(l => l.discovery_source === 'competitor_post_intercept').length;
                const inSequence = leads.filter(l => l.status === 'in_sequence').length;
                const acceptedConnections = leads.filter(l => l.closely_connection_status === 'accepted').length;

                // Count generated DMs from activities
                const typedActivities = (activities ?? []) as any[];
                const dmsGenerated = typedActivities.filter(a => a.action_type === 'generated_dm' || a.action_type === 'linkedin_connect').length;

                // New metrics calculations
                const completedOutreach = typedActivities.filter(a => (a.channel === 'linkedin_dm' || a.channel === 'email') && a.status === 'sent').length;
                const pendingOutreach = typedActivities.filter(a => (a.channel === 'linkedin_dm' || a.channel === 'email') && a.status === 'pending').length;

                const completedCalls = typedActivities.filter(a => a.channel === 'call' && a.status === 'sent').length;
                const pendingCalls = typedActivities.filter(a => a.channel === 'call' && a.status === 'pending').length;

                const completedContent = typedActivities.filter(a => a.channel === 'content' && a.status === 'sent').length;
                const pendingContent = typedActivities.filter(a => a.channel === 'content' && a.status === 'pending').length;

                const meetingsBooked = leads.filter(l => l.status === 'meeting_booked').length;
                const messagesSent = dmsGenerated; // Using dmsGenerated as a proxy for messagesSent
                const repliesReceived = leads.filter(l => l.status === 'replied').length;

                // Build recent activity feed
                const recentActivity = typedActivities.slice(0, 5).map((a: any) => {
                    const name = a.outreach_leads?.contact_name ?? a.outreach_leads?.company ?? 'Unknown';
                    const typeLabel =
                        a.action_type === 'generated_dm' ? 'Generated DM' :
                            a.action_type === 'linkedin_connect' ? 'Sent Connection' :
                                a.action_type === 'send_email' ? 'Sent Email' :
                                    a.action_type;
                    const createdAt = new Date(a.created_at);
                    const diffMs = Date.now() - createdAt.getTime();
                    const diffMin = Math.floor(diffMs / 60000);
                    const time = diffMin < 60 ? `${diffMin}m ago` : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago` : `${Math.floor(diffMin / 1440)}d ago`;
                    return { type: typeLabel, name, time };
                });

                setMetrics({
                    totalLeads,
                    hotLeads,
                    interceptedLeads,
                    dmsGenerated,
                    inSequence,
                    acceptedConnections,
                    completedOutreach,
                    pendingOutreach,
                    completedCalls,
                    pendingCalls,
                    completedContent,
                    pendingContent,
                    meetingsBooked,
                    messagesSent,
                    repliesReceived,
                    recentActivity
                });
            } catch (err) {
                console.error('useOutreachMetrics error:', err);
            } finally {
                setLoading(false);
            }
        }

        fetchMetrics();
    }, []);

    return { metrics, loading };
}
