import React from 'react';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
    badge?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, badge }) => (
    <div className="flex items-start justify-between px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-center gap-3">
            <div>
                <div className="flex items-center gap-2.5">
                    <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
                    {badge}
                </div>
                {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
            </div>
        </div>
        {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
);
