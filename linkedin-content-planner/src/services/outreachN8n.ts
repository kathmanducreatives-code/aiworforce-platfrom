import type { OutreachActivity } from '../types/outreach';

const EMAIL_WEBHOOK_URL = import.meta.env.VITE_N8N_OUTREACH_EMAIL_WEBHOOK_URL;
const LINKEDIN_WEBHOOK_URL = import.meta.env.VITE_N8N_OUTREACH_LINKEDIN_WEBHOOK_URL;
const CAL_LINK = import.meta.env.VITE_CAL_BOOKING_LINK || '';

export async function executeOutreachAction(activity: OutreachActivity, leadDetails: Record<string, any>) {
    const isEmail = activity.channel === 'email' || activity.action_type === 'send_email';
    const isLinkedIn = activity.channel.startsWith('linkedin') || activity.action_type.startsWith('linkedin');
    const isCall = activity.channel === 'call' || activity.action_type === 'call';

    if (isCall) {
        // Calls are executed manually via the Dialer interface
        return { success: true, message: 'Call task logged locally. Proceed to dialer.' };
    }

    const webhookUrl = isEmail ? EMAIL_WEBHOOK_URL : (isLinkedIn ? LINKEDIN_WEBHOOK_URL : null);

    if (!webhookUrl && !isLinkedIn && !isEmail && !isCall) {
        // Manual tasks don't go to N8N
        return { success: true, message: 'Manual task completed locally.' };
    }

    if (!webhookUrl) {
        throw new Error(`Webhook URL for channel '${activity.channel}' is not configured in environment variables.`);
    }

    // Prepare Payload
    const payload = {
        action_type: activity.action_type,
        channel: activity.channel,
        lead_id: activity.lead_id,
        activity_id: activity.id,
        lead_info: leadDetails,
        subject: activity.subject,
        body: activity.body,
        cal_link: CAL_LINK,
        supabase_url: import.meta.env.VITE_SUPABASE_URL,
        supabase_key: import.meta.env.VITE_SUPABASE_ANON_KEY,
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`N8N execution failed with status ${response.status}: ${errorText}`);
        }

        return { success: true };
    } catch (error: any) {
        console.error("Execute Outreach Action Error:", error);
        throw new Error(error.message || "Failed to execute action via n8n");
    }
}
