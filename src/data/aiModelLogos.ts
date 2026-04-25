import openaiLogo from '@/assets/ai-logos/openai.png';
import claudeLogo from '@/assets/ai-logos/claude.png';
import geminiLogo from '@/assets/ai-logos/gemini.png';
import type { AgentModelKey } from './agentProfiles';

export interface AiModel {
  key: AgentModelKey;
  label: string;
  logo: string;
  pillClassName: string;
  /** Background tone for the logo chip — keeps colored marks legible on dark surfaces */
  chipBg: string;
}

export const AI_MODELS: Record<AgentModelKey, AiModel> = {
  'gpt-4o': {
    key: 'gpt-4o',
    label: 'GPT-4o',
    logo: openaiLogo,
    pillClassName: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    chipBg: 'bg-white',
  },
  'claude-sonnet': {
    key: 'claude-sonnet',
    label: 'Claude Sonnet',
    logo: claudeLogo,
    pillClassName: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
    chipBg: 'bg-orange-500/15',
  },
  'claude-haiku': {
    key: 'claude-haiku',
    label: 'Claude Haiku',
    logo: claudeLogo,
    pillClassName: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
    chipBg: 'bg-orange-500/15',
  },
  'gemini-pro': {
    key: 'gemini-pro',
    label: 'Gemini Pro',
    logo: geminiLogo,
    pillClassName: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    chipBg: 'bg-white',
  },
};
