import { AI_MODELS } from '@/data/aiModelLogos';
import { AI_TOOLS } from '@/data/aiToolLogos';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  label?: string;
}

const LOGOS = [
  { src: AI_MODELS['gpt-4o'].logo,        label: 'OpenAI',      bg: 'bg-white' },
  { src: AI_MODELS['claude-sonnet'].logo, label: 'Anthropic',   bg: 'bg-orange-500/10' },
  { src: AI_MODELS['gemini-pro'].logo,    label: 'Gemini',      bg: 'bg-white' },
  { src: AI_TOOLS.firecrawl.logo,         label: 'Firecrawl',   bg: 'bg-white' },
  { src: AI_TOOLS.elevenlabs.logo,        label: 'ElevenLabs',  bg: 'bg-white' },
];

export default function PoweredByStrip({ className, label = 'POWERED BY THE BEST AI INFRASTRUCTURE' }: Props) {
  return (
    <div className={cn('flex flex-col items-center gap-5', className)}>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">{label}</p>
      <div className="flex items-center gap-6 md:gap-10 flex-wrap justify-center">
        {LOGOS.map((l) => (
          <div key={l.label} className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
            <div className={cn('w-8 h-8 rounded-md flex items-center justify-center overflow-hidden', l.bg)}>
              <img src={l.src} alt={l.label} className="w-6 h-6 object-contain" />
            </div>
            <span className="text-xs text-white/50 font-medium">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
