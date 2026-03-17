import type { OutreachLead } from "../types/lead.js";
import type { PipelineEnv } from "../utils/env.js";
import { askClaudeJson, askClaudeText } from "../utils/anthropic.js";

type MessagePayload = {
  personalized_message: string;
  detected_pain_point: string;
  buying_signal_summary: string;
};

function fallbackMessage(lead: OutreachLead): MessagePayload {
  return {
    personalized_message: `Hi ${lead.contact_name?.split(" ")[0] || "there"}, saw ${lead.company_name} is actively hiring. Screening Pilot helps teams hire direct for a flat fee instead of agency commissions. Open to a quick look?`,
    detected_pain_point: lead.pain_point || "hiring friction",
    buying_signal_summary: lead.buying_signal_summary || "Active hiring signal"
  };
}

export async function generateMessages(leads: OutreachLead[], env: PipelineEnv): Promise<OutreachLead[]> {
  console.log("[Stage 5] Generating personalized messages...");

  if (!env.anthropicApiKey) {
    console.warn("[Stage 5] ANTHROPIC_API_KEY missing; using fallback templates.");
    return leads.map(lead => ({ ...lead, ...fallbackMessage(lead) }));
  }

  const output: OutreachLead[] = [];

  for (const lead of leads) {
    try {
      const isLinkedinLead = lead.source === "linkedin_comment";

      const system =
        "You are an expert B2B sales copywriter for Screening Pilot, an AI recruiting platform replacing agencies with a flat EUR149/month model. Write concise, human outreach with one clear CTA.";

      const user = isLinkedinLead
        ? `Lead Name: ${lead.contact_name || "Unknown"}\nTitle: ${lead.contact_title || ""}\nCompany: ${lead.company_name}\nTheir Comment: "${lead.original_comment || ""}"\nDetected Pain Point: ${lead.pain_point}\nCompany Enrichment Signals: ${lead.enrichment_data.enrichment_summary || JSON.stringify(lead.enrichment_data)}\n\nReturn JSON with keys: personalized_message, detected_pain_point, buying_signal_summary.`
        : `Lead Company: ${lead.company_name}\nOpen Role: ${lead.job_role || "Unknown"}\nDate Posted: ${lead.created_at}\nCompany Signals: ${lead.enrichment_data.enrichment_summary || JSON.stringify(lead.enrichment_data)}\n\nWrite a LinkedIn DM or cold email for founder/hiring manager. Return JSON with keys: personalized_message, detected_pain_point, buying_signal_summary.`;

      let generated: MessagePayload;
      try {
        generated = await askClaudeJson<MessagePayload>({
          apiKey: env.anthropicApiKey,
          model: env.claudeModel,
          system,
          user,
          maxTokens: 900
        });
      } catch {
        const text = await askClaudeText({
          apiKey: env.anthropicApiKey,
          model: env.claudeModel,
          system,
          user,
          maxTokens: 500
        });

        generated = {
          personalized_message: text,
          detected_pain_point: lead.pain_point || "hiring friction",
          buying_signal_summary: lead.buying_signal_summary || "Hiring/buying signal detected"
        };
      }

      output.push({
        ...lead,
        personalized_message: generated.personalized_message,
        pain_point: generated.detected_pain_point || lead.pain_point,
        buying_signal_summary: generated.buying_signal_summary || lead.buying_signal_summary
      });
    } catch (error) {
      console.error(`[Stage 5] Message generation failed for ${lead.company_name}:`, error);
      output.push({ ...lead, ...fallbackMessage(lead) });
    }
  }

  return output;
}
