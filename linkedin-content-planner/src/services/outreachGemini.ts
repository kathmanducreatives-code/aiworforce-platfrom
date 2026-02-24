import { GoogleGenAI } from '@google/genai';
import type { Signal } from '../types/outreach';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

export async function researchLeadSignals(
    company: string,
    industry: string | null,
    companySize: string | null,
    contactName: string,
    title: string | null,
    notes: string | null
): Promise<Signal[]> {
    if (!apiKey) throw new Error("Gemini API key is not configured.");

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
You are a B2B sales research assistant. Research the following company and find 2-5 actionable outbound signals I can use for cold outreach.

Company: ${company}
Industry: ${industry || 'Unknown'}
Company Size: ${companySize || 'Unknown'}
Target Contact: ${contactName}, ${title || 'Unknown Role'}
Additional Context: ${notes || 'None'}

For each signal, return a JSON array with this exact structure:
[
  {
    "type": "hiring" | "funding" | "new_exec" | "tech_change" | "content_signal" | "trigger_event" | "pain_indicator",
    "summary": "Brief description of the signal",
    "detail": "Why this matters for outreach",
    "hook": "A one-sentence email opening line using this signal",
    "confidence": "high" | "medium" | "low",
    "date_detected": "YYYY-MM-DD or null if unknown"
  }
]

Review search results if needed.
Only return the JSON array, no markdown formatting like \`\`\`json.
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                temperature: 0.2, // Low temp for more factual/structured response
            }
        });

        let text = response.text || "[]";

        // Clean up markdown block if the model accidentally included it
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const signals: Signal[] = JSON.parse(text);
        return signals;
    } catch (error: any) {
        console.error("Signal Research Error:", error);
        throw new Error(error.message || "Failed to research signals");
    }
}

export async function generateEmailDraft(
    lead: {
        company: string;
        contact_name: string;
        title: string | null;
        signals: Signal[] | null;
        notes: string | null;
    },
    userContext: {
        product_name: string;
        value_prop: string;
        sender_name: string;
    }
): Promise<{ subject: string; body: string }> {
    if (!apiKey) throw new Error("Gemini API key is not configured.");

    const ai = new GoogleGenAI({ apiKey });

    const signalsText = lead.signals?.length
        ? lead.signals.map(s => `- [${s.type}] ${s.summary}\n  Hook Idea: ${s.hook}`).join('\n')
        : 'No specific signals researched.';

    const prompt = `
You are an elite B2B copywriter who writes highly-converting, short, and personalized cold emails.
Your goal is to write a single cold email to the target prospect.

PROSPECT CONTEXT:
Name: ${lead.contact_name}
Title: ${lead.title || 'Unknown'}
Company: ${lead.company}
Notes: ${lead.notes || 'None'}
Actionable Signals:
${signalsText}

YOUR CONTEXT:
Sender: ${userContext.sender_name}
Product: ${userContext.product_name}
Value Prop: ${userContext.value_prop}

RULES FOR THE EMAIL:
1. Keep it under 100 words.
2. Use one of the actionable signals as the opening hook (if available).
3. Do not introduce yourself formally ("Hi I'm XYZ from ABC").
4. Tie their specific situation (signal) to the value prop of your product.
5. End with a soft, low-friction call to action (e.g. "Open to a quick chat?" or "Worth exploring?").
6. Output MUST be valid JSON with this exact structure:
{
  "subject": "The email subject line",
  "body": "The full email body text."
}
Only return the JSON object, no markdown formatting.
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                temperature: 0.7, // Slightly higher temp for creativity
            }
        });

        let text = response.text || "{}";
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const draft = JSON.parse(text);
        return {
            subject: draft.subject || "No subject generated",
            body: draft.body || "No body generated"
        };
    } catch (error: any) {
        console.error("Draft Generation Error:", error);
        throw new Error(error.message || "Failed to generate draft");
    }
}

