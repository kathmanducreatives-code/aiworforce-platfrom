import React from 'react';

type BadgeVariant = 'blue' | 'violet' | 'emerald' | 'amber' | 'red' | 'slate' | 'cyan';

const variants: Record<BadgeVariant, string> = {
    blue:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
    violet:  'bg-violet-500/10 text-violet-400 border-violet-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    amber:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
    red:     'bg-red-500/10 text-red-400 border-red-500/20',
    slate:   'bg-white/5 text-slate-400 border-white/10',
    cyan:    'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
};

interface BadgeProps {
    children: React.ReactNode;
    variant?: BadgeVariant;
    className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'slate', className = '' }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${variants[variant]} ${className}`}>
        {children}
    </span>
);
