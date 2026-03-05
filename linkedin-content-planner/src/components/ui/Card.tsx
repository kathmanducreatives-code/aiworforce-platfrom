import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    hover?: boolean;
    padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = { none: '', sm: 'p-4', md: 'p-6', lg: 'p-8' };

export const Card: React.FC<CardProps> = ({ children, className = '', hover = false, padding = 'md' }) => (
    <div className={[
        'bg-white/[0.03] border border-white/[0.08] rounded-2xl',
        hover ? 'transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.05] hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.4)]' : '',
        paddingMap[padding],
        className,
    ].join(' ')}>
        {children}
    </div>
);

export const CardHeader: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }> = ({ title, subtitle, action, icon }) => (
    <div className="flex items-start justify-between mb-5">
        <div className="flex items-start gap-3">
            {icon && <div className="mt-1 shrink-0 text-slate-400 font-normal">{icon}</div>}
            <div>
                <h3 className="text-base font-semibold text-white">{title}</h3>
                {subtitle && <div className="text-sm text-slate-400 mt-0.5">{subtitle}</div>}
            </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
    </div>
);
