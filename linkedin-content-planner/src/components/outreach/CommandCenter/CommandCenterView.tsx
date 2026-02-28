
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import StatusBar from './StatusBar';
import TodaysActions from './TodaysActions';
import ActivityTimeline from './ActivityTimeline';

export default function CommandCenterView() {
    const { leads, loading } = useOutreachLeads();

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
                Loading Command Center...
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
            <div style={{ padding: '32px 40px 60px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>

                {/* Header */}
                <div style={{ marginBottom: '32px' }}>
                    <h1 style={{ fontSize: '28px', color: '#fff', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: '8px', fontFamily: '"Cabinet Grotesk", "Satoshi", sans-serif' }}>
                        Command Center
                    </h1>
                    <p style={{ color: '#888', fontSize: '14px' }}>
                        Overview of your automated outreach pipeline and recent activities.
                    </p>
                </div>

                {/* 6-Pill Status Bar */}
                <StatusBar leads={leads} />

                {/* Main Content Split: Left (Actions) / Right (Timeline) */}
                <TodaysActions leads={leads} />

                <ActivityTimeline />
            </div>
        </div>
    );
}
