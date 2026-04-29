import type { AgentDept, AgentModelKey } from '@/data/agentProfiles';

export interface CapabilityRow {
  capability: string;
  input_type: string;
  output_type: string;
}

export interface SkillConfig {
  [skillKey: string]: Record<string, any>;
}

export interface BuilderForm {
  name: string;
  color: string;          // swatch key
  department: AgentDept | null;
  rolePrompt: string;
  model: AgentModelKey;
  capabilities: CapabilityRow[];
  tools: string[];        // tool keys
  toolConfig: Record<string, Record<string, any>>; // e.g. { webhook: { url } }
  skills: string[];       // equipped skill keys
  skillConfig: SkillConfig;
}

export const TOTAL_STEPS = 7;
