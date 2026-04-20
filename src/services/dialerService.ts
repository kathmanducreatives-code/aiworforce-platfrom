/**
 * Service for interacting with the PowerDialer n8n backend.
 * This class encapsulates the logic for starting/stopping the dialer
 * and fetching the live status.
 */

import { toast } from 'sonner';

export interface DialerStatus {
    isLoopActive: boolean;
    currentCall: {
        name: string | null;
        phone: string | null;
        status: string;
        status_label?: string;
        started_at: string | null;
    } | null;
    sessionLog: Array<{
        name: string;
        phone: string;
        outcome: string;
        amd_result?: string;
        timestamp: string;
    }>;
}

const BASE_URL = 'https://n8n.prasidha.me';
const DIALER_SECRET = 'my-secret-dialer-key'; // Should move to env

export const dialerService = {
    async start(workspaceId: string = 'default') {
        try {
            const res = await fetch(`${BASE_URL}/webhook/power-dialer-start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-dialer-secret': DIALER_SECRET
                },
                body: JSON.stringify({ workspaceId })
            });
            if (!res.ok) throw new Error('Failed to start dialer');
            toast.success('PowerDialer loop initiated');
            return true;
        } catch (err) {
            console.error(err);
            toast.error('Connection error: Could not reach n8n');
            return false;
        }
    },

    async stop(workspaceId: string = 'default') {
        try {
            const res = await fetch(`${BASE_URL}/webhook/power-dialer-stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-dialer-secret': DIALER_SECRET
                },
                body: JSON.stringify({ workspaceId })
            });
            if (!res.ok) throw new Error('Failed to stop dialer');
            toast.success('Halt signal sent to dialer');
            return true;
        } catch (err) {
            console.error(err);
            toast.error('Failed to stop dialer');
            return false;
        }
    },

    async fetchStatus(): Promise<DialerStatus | null> {
        try {
            const res = await fetch(`${BASE_URL}/webhook/power-dialer-status?token=${DIALER_SECRET}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            return null;
        }
    }
};
