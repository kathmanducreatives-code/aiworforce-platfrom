import firecrawlLogo from '@/assets/ai-logos/firecrawl.png';
import elevenlabsLogo from '@/assets/ai-logos/elevenlabs.webp';

export interface AiTool {
  key: string;
  label: string;
  logo: string;
  description: string;
}

export const AI_TOOLS: Record<string, AiTool> = {
  firecrawl: {
    key: 'firecrawl',
    label: 'Firecrawl',
    logo: firecrawlLogo,
    description: 'Web scraping & deep search',
  },
  elevenlabs: {
    key: 'elevenlabs',
    label: 'ElevenLabs',
    logo: elevenlabsLogo,
    description: 'Voice & audio generation',
  },
};
