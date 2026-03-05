import React from 'react';

interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        {icon && <div className="text-slate-600 mb-2">{icon}</div>}
        <p className="text-white font-semibold text-base">{title}</p>
        {description && <p className="text-slate-500 text-sm max-w-xs">{description}</p>}
        {action}
    </div>
);
