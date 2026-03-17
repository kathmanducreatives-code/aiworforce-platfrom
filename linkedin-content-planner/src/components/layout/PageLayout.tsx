import React from 'react';

interface PageLayoutProps {
    title?: string;
    subtitle?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
    noPadding?: boolean;
    className?: string;
}

/**
 * PageLayout — the standard wrapper for every page view.
 * Provides a bounded max-width, consistent padding, and a scrollable
 * content area so nothing ever gets clipped.
 */
const PageLayout: React.FC<PageLayoutProps> = ({
    title,
    subtitle,
    actions,
    children,
    noPadding = false,
    className = '',
}) => {
    return (
        <div className={`flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${className}`}>
            <div className={noPadding ? 'flex-1 flex flex-col min-h-0' : 'page-content flex-1'}>
                {(title || actions) && (
                    <div className="flex items-start justify-between shrink-0 mb-6">
                        {title && (
                            <div>
                                <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
                                {subtitle && (
                                    <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
                                )}
                            </div>
                        )}
                        {actions && (
                            <div className="flex items-center gap-2 shrink-0 ml-4">
                                {actions}
                            </div>
                        )}
                    </div>
                )}
                {children}
            </div>
        </div>
    );
};

export default PageLayout;
