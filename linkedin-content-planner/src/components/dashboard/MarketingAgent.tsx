import { useState } from 'react';
import { Send, Bot, Loader2, Sparkles } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { toast } from 'sonner';
import { useMarketingTasks } from '../../hooks/useMarketingTasks';
import type { CreateMarketingTaskInput } from '../../types/marketing';

interface MarketingAgentProps {
    onTasksCreated?: () => void;
}

export default function MarketingAgent({ onTasksCreated }: MarketingAgentProps) {
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const { addTasks } = useMarketingTasks();

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    const parseGeminiTasks = async (userInput: string): Promise<CreateMarketingTaskInput[]> => {
        if (!apiKey) throw new Error("Gemini API key is missing.");

        const ai = new GoogleGenAI({ apiKey });

        const systemPrompt = `
You are an expert AI Marketing Director. Your job is to take the user's request and turn it into actionable, granular daily marketing tasks.

USER REQUEST: "${userInput}"

Generate a list of 1 to 5 marketing tasks based on the request.
For each task, provide a clear, actionable title, a short description, and a type category (e.g., 'content', 'research', 'outreach', 'strategy', 'analysis').

Return a JSON array exactly matching this structure:
[
  {
    "title": "Task title here",
    "description": "Short explanation of what needs to be done",
    "type": "content"
  }
]

IMPORTANT: Do not wrap the JSON in markdown blocks (no \`\`\`json). Just return the raw JSON array.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: systemPrompt,
            config: { temperature: 0.7 }
        });

        let text = response.text || "[]";
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const tasksParsed = JSON.parse(text);

        if (!Array.isArray(tasksParsed)) {
            throw new Error("Invalid output format from AI.");
        }

        return tasksParsed.map((t: any) => ({
            title: t.title || "Untitled Task",
            description: t.description || "",
            type: t.type || "marketing",
            status: 'pending',
            scheduled_date: new Date().toISOString()
        }));
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) return;

        setIsGenerating(true);
        try {
            const generatedTasks = await parseGeminiTasks(prompt);

            if (generatedTasks.length === 0) {
                toast("Agent couldn't find any actionable tasks from that prompt.");
                return;
            }

            await addTasks(generatedTasks);
            toast.success(`Generated ${generatedTasks.length} new marketing tasks!`);
            setPrompt('');

            if (onTasksCreated) onTasksCreated();
        } catch (error: any) {
            console.error("Agent Error:", error);
            toast.error(error.message || "Failed to generate tasks.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '16px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', background: '#141414', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: 'linear-gradient(135deg, #a855f7, #ec4899)', padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Sparkles size={20} color="#fff" />
                </div>
                <div>
                    <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        AI Agent
                        <span style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#c084fc', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', textTransform: 'uppercase' }}>Gemini 2.5</span>
                    </h2>
                    <p style={{ color: '#888', fontSize: '13px', marginTop: '2px' }}>Generate daily marketing priorities on demand.</p>
                </div>
            </div>

            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px', padding: '16px' }}>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g. 'Plan a campaign to launch our new feature targeting SaaS founders...'"
                        style={{
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            color: '#fff',
                            fontSize: '14px',
                            resize: 'none',
                            outline: 'none',
                            minHeight: '80px',
                            lineHeight: '1.5'
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleGenerate();
                            }
                        }}
                    />
                </div>

                <button
                    onClick={handleGenerate}
                    disabled={isGenerating || !prompt.trim()}
                    style={{
                        background: prompt.trim() ? '#fff' : '#333',
                        color: prompt.trim() ? '#000' : '#888',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        cursor: prompt.trim() && !isGenerating ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s',
                        width: '100%'
                    }}
                >
                    {isGenerating ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            Drafting Plan...
                        </>
                    ) : (
                        <>
                            <Send size={16} />
                            Generate Tasks
                        </>
                    )}
                </button>

                <div style={{ textAlign: 'center', color: '#666', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <Bot size={14} /> Powered by Google AI Studio
                </div>
            </div>
        </div>
    );
}
