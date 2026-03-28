import { useState } from 'react';
import { cn } from '@/lib/utils';

interface AgentAvatarProps {
  name: string;
  photo: string;
  status?: 'active' | 'idle' | 'disabled';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
} as const;

const PULSE_SIZE = {
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
  lg: 'w-3.5 h-3.5',
} as const;

const AgentAvatar = ({ name, photo, status = 'active', size = 'md', className }: AgentAvatarProps) => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className={cn('relative flex-shrink-0', className)}>
      {imgFailed ? (
        <div
          className={cn(
            'rounded-full bg-primary/10 border-2 border-card flex items-center justify-center font-bold text-primary',
            SIZE_MAP[size]
          )}
        >
          {name[0]}
        </div>
      ) : (
        <img
          src={photo}
          alt={name}
          onError={() => setImgFailed(true)}
          className={cn('rounded-full border-2 border-card object-cover', SIZE_MAP[size])}
        />
      )}

      {status === 'active' && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-card bg-emerald-500',
            PULSE_SIZE[size]
          )}
        >
          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
        </span>
      )}
      {status === 'idle' && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-card bg-amber-500',
            PULSE_SIZE[size]
          )}
        />
      )}
    </div>
  );
};

export default AgentAvatar;
