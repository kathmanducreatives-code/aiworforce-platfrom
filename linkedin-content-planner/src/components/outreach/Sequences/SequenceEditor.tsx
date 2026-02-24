import { useState } from 'react';
import { Mail, Linkedin, Clock, Trash2, ArrowLeft, Save, GripVertical } from 'lucide-react';
import type { SequenceStep, OutreachSequence } from '../../../types/outreach';
import { toast } from 'sonner';

import { useOutreachSequences } from '../../../hooks/useOutreachSequences';

interface SequenceEditorProps {
    sequenceId: string;
    onClose: () => void;
}

export default function SequenceEditor({ sequenceId, onClose }: SequenceEditorProps) {
    const { sequences, saveSequence } = useOutreachSequences();
    const existingSequence = sequences.find(s => s.id === sequenceId);

    const [sequence, setSequence] = useState<OutreachSequence>(existingSequence || {
        id: `new-${Date.now()}`,
        name: 'New Sequence',
        description: '',
        status: 'draft',
        created_at: new Date().toISOString(),
        settings: { send_window: '9am-5pm EST', max_daily_sends: 50 },
        steps: []
    });

    const [selectedStepId, setSelectedStepId] = useState<string | null>(sequence.steps[0]?.id || null);

    const handleAddStep = (type: SequenceStep['type']) => {
        const newStep: SequenceStep = {
            id: `new-${Date.now()}`,
            sequence_id: sequence.id,
            step_number: sequence.steps.length + 1,
            type,
            config: type === 'delay' ? { days: 2 } : { body: '' },
            created_at: new Date().toISOString()
        };

        setSequence(prev => ({
            ...prev,
            steps: [...prev.steps, newStep]
        }));
        setSelectedStepId(newStep.id);
    };

    const handleDeleteStep = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSequence(prev => {
            const newSteps = prev.steps.filter(s => s.id !== id).map((s, idx) => ({ ...s, step_number: idx + 1 }));
            return { ...prev, steps: newSteps };
        });
        if (selectedStepId === id) setSelectedStepId(null);
    };

    const handleUpdateStepConfig = (id: string, newConfig: any) => {
        setSequence(prev => ({
            ...prev,
            steps: prev.steps.map(s => s.id === id ? { ...s, config: { ...s.config, ...newConfig } } : s)
        }));
    };

    const handleSave = async () => {
        const { error } = await saveSequence(sequence);
        if (!error) {
            toast.success("Sequence saved successfully!");
            onClose();
        }
    };

    const selectedStep = sequence.steps.find(s => s.id === selectedStepId);

    const getStepIcon = (type: string) => {
        switch (type) {
            case 'email': return <Mail size={16} color="#3b82f6" />;
            case 'linkedin_connect':
            case 'linkedin_message': return <Linkedin size={16} color="#0077b5" />;
            case 'delay': return <Clock size={16} color="#a855f7" />;
            default: return <Mail size={16} />;
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#141414' }}>

            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d0d0d' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #333', color: '#e0e0e0', padding: '8px', borderRadius: '8px', cursor: 'pointer', display: 'flex' }}>
                        <ArrowLeft size={16} />
                    </button>
                    <div>
                        <input
                            value={sequence.name}
                            onChange={e => setSequence({ ...sequence, name: e.target.value })}
                            style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '18px', fontWeight: 600, outline: 'none', width: '300px' }}
                        />
                        <div style={{ color: '#888', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                            <span style={{ color: sequence.status === 'active' ? '#00e5a0' : '#888', textTransform: 'capitalize' }}>{sequence.status}</span>
                            • {sequence.steps.length} steps
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleSave}
                    style={{
                        background: '#00e5a0', color: '#000', border: 'none',
                        padding: '10px 20px', borderRadius: '8px', fontSize: '13px',
                        fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
                        cursor: 'pointer'
                    }}
                >
                    <Save size={16} /> Save Sequence
                </button>
            </div>

            {/* Main Editor Area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                {/* Timeline Builder (Left) */}
                <div style={{ width: '350px', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', background: '#111' }}>
                    <div style={{ padding: '20px', borderBottom: '1px solid #2a2a2a' }}>
                        <h3 style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: 600 }}>Sequence Steps</h3>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                        {sequence.steps.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#666', fontSize: '13px', marginTop: '40px' }}>
                                No steps yet. Add your first touchpoint below.
                            </div>
                        ) : (
                            sequence.steps.map((step, idx) => (
                                <div key={step.id} style={{ display: 'flex', gap: '12px', marginBottom: '16px', position: 'relative' }}>

                                    {/* Timeline Line */}
                                    {idx !== sequence.steps.length - 1 && (
                                        <div style={{ position: 'absolute', left: '15px', top: '32px', bottom: '-16px', width: '2px', background: '#2a2a2a', zIndex: 0 }} />
                                    )}

                                    {/* Number Badge */}
                                    <div style={{
                                        width: '32px', height: '32px', borderRadius: '50%', background: selectedStepId === step.id ? '#3b82f6' : '#222',
                                        color: '#fff', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        zIndex: 1, border: '4px solid #111'
                                    }}>
                                        {step.step_number}
                                    </div>

                                    {/* Step Card */}
                                    <div
                                        onClick={() => setSelectedStepId(step.id)}
                                        style={{
                                            flex: 1, background: selectedStepId === step.id ? 'rgba(59, 130, 246, 0.1)' : '#1a1a1a',
                                            border: `1px solid ${selectedStepId === step.id ? '#3b82f6' : '#333'}`,
                                            borderRadius: '8px', padding: '12px', cursor: 'pointer', transition: 'all 0.2s',
                                            display: 'flex', flexDirection: 'column', gap: '8px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, textTransform: 'capitalize' }}>
                                                {getStepIcon(step.type)}
                                                {step.type.replace('_', ' ')}
                                            </div>
                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                <button onClick={(e) => handleDeleteStep(step.id, e)} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '2px' }}><Trash2 size={14} /></button>
                                                <div style={{ color: '#444', cursor: 'grab', padding: '2px' }}><GripVertical size={14} /></div>
                                            </div>
                                        </div>

                                        <div style={{ color: '#888', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {step.type === 'delay' ? `Wait ${step.config.days} days` : (step.config.subject || 'No subject')}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}

                        {/* Add Step Button */}
                        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>Add next step</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <button onClick={() => handleAddStep('email')} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ccc', padding: '8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Mail size={12} /> Email</button>
                                <button onClick={() => handleAddStep('linkedin_connect')} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ccc', padding: '8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Linkedin size={12} /> Connect</button>
                                <button onClick={() => handleAddStep('linkedin_message')} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ccc', padding: '8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Linkedin size={12} /> Message</button>
                                <button onClick={() => handleAddStep('delay')} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ccc', padding: '8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Clock size={12} /> Delay</button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Step Configuration (Right) */}
                <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
                    {selectedStep ? (
                        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                            <h2 style={{ color: '#fff', fontSize: '20px', fontWeight: 600, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px', textTransform: 'capitalize' }}>
                                {getStepIcon(selectedStep.type)}
                                Configure {selectedStep.type.replace('_', ' ')}
                            </h2>

                            {selectedStep.type === 'delay' && (
                                <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px', padding: '24px' }}>
                                    <label style={{ display: 'block', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>Wait for (Days)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={selectedStep.config.days || 1}
                                        onChange={(e) => handleUpdateStepConfig(selectedStep.id, { days: parseInt(e.target.value) })}
                                        style={{ background: '#0d0d0d', border: '1px solid #333', color: '#fff', padding: '10px 14px', borderRadius: '8px', fontSize: '14px', outline: 'none', width: '120px' }}
                                    />
                                </div>
                            )}

                            {(selectedStep.type === 'email') && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                    <div>
                                        <label style={{ display: 'block', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>Subject Line</label>
                                        <input
                                            value={selectedStep.config.subject || ''}
                                            onChange={(e) => handleUpdateStepConfig(selectedStep.id, { subject: e.target.value })}
                                            placeholder="Enter subject..."
                                            style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '12px 16px', borderRadius: '8px', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>Email Body</label>
                                        <textarea
                                            value={selectedStep.config.body || ''}
                                            onChange={(e) => handleUpdateStepConfig(selectedStep.id, { body: e.target.value })}
                                            placeholder="Type your message here. Use {{variables}} for personalization."
                                            rows={12}
                                            style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0', padding: '16px', borderRadius: '8px', fontSize: '14px', outline: 'none', resize: 'vertical', lineHeight: '1.6', fontFamily: "'Inter', sans-serif" }}
                                        />
                                    </div>
                                </div>
                            )}

                            {(selectedStep.type.startsWith('linkedin_')) && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                    <div>
                                        <label style={{ display: 'block', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>LinkedIn Message</label>
                                        <textarea
                                            value={selectedStep.config.message || ''}
                                            onChange={(e) => handleUpdateStepConfig(selectedStep.id, { message: e.target.value })}
                                            placeholder={selectedStep.type === 'linkedin_connect' ? "Add a note to your connection request (optional)." : "Type your LinkedIn message..."}
                                            rows={8}
                                            style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0', padding: '16px', borderRadius: '8px', fontSize: '14px', outline: 'none', resize: 'vertical', lineHeight: '1.6', fontFamily: "'Inter', sans-serif" }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Variable Helper */}
                            <div style={{ marginTop: '32px', padding: '16px', background: 'rgba(59, 130, 246, 0.05)', border: '1px dashed #3b82f644', borderRadius: '8px' }}>
                                <h4 style={{ color: '#3b82f6', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Available Variables</h4>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    {['{{first_name}}', '{{last_name}}', '{{company}}', '{{title}}', '{{signal}}'].map(v => (
                                        <span key={v} style={{ background: '#1a1a1a', color: '#ccc', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', border: '1px solid #333' }}>{v}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                            Select a step from the timeline to configure it.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
