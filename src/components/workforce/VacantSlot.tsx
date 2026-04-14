import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VacantSlotProps {
  deptColor: string;
  onHire: () => void;
}

const VacantSlot = ({ deptColor, onHire }: VacantSlotProps) => {
  return (
    <button
      onClick={onHire}
      className={cn(
        'w-full py-5 px-4 rounded-xl transition-all duration-300 group/vacant',
        'border border-dashed border-[rgba(255,255,255,0.06)]',
        'hover:border-[rgba(255,255,255,0.15)]',
        'bg-transparent hover:bg-[rgba(255,255,255,0.015)]'
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className="w-8 h-8 rounded-full border border-dashed flex items-center justify-center transition-all duration-300 group-hover/vacant:scale-110"
          style={{
            borderColor: `${deptColor}20`,
          }}
        >
          <Plus
            className="h-3.5 w-3.5 transition-colors duration-300 text-white/15 group-hover/vacant:text-white/40"
            style={{
              // On hover, use dept color
            }}
          />
        </div>
        <span className="text-[10px] font-mono text-white/15 tracking-[0.2em] uppercase group-hover/vacant:text-white/30 transition-colors">
          OPEN REQUISITION
        </span>
        <span className="text-[10px] text-white/10 group-hover/vacant:text-white/20 transition-colors">
          Click to hire
        </span>
      </div>
    </button>
  );
};

export default VacantSlot;
