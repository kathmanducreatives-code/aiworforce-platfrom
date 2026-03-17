import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    hover?: boolean;
    glass?: boolean;
    padding?: 'none' | 'sm' | 'md' | 'lg';
    noPadding?: boolean;
}

const paddingMap = { none: '', sm: 'p-4', md: 'p-6', lg: 'p-8' };

/**
 * Card — the core container component.
 * Pass `glass` for the full glassmorphism look, or leave unset for
 * the simpler dark surface style.
 */
export const Card: React.FC<CardProps> = ({
    children,
    className = '',
    hover = false,
    glass = false,
    padding = 'md',
    noPadding = false,
}) => (
    <div
        className={[
            glass ? 'glass-card' : 'bg-[#111113] border border-white/[0.08]',
            'rounded-2xl',
            hover ? 'transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] cursor-pointer' : '',
            noPadding ? '' : paddingMap[padding],
            'overflow-hidden',
            className,
        ].join(' ')}
    >
        {children}
    </div>
);

export const CardHeader: React.FC<{
    title: string;
    subtitle?: React.ReactNode;
    action?: React.ReactNode;
    icon?: React.ReactNode;
}> = ({ title, subtitle, action, icon }) => (
    <div className="flex items-start justify-between mb-5">
        <div className="flex items-start gap-3">
            {icon && <div className="mt-0.5 shrink-0 text-slate-400">{icon}</div>}
            <div>
                <h3 className="text-[14px] font-bold text-white tracking-tight">{title}</h3>
                {subtitle && <div className="text-[12px] text-slate-500 mt-0.5">{subtitle}</div>}
            </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
    </div>
);
