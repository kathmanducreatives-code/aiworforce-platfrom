import React from 'react';

interface PageTransitionProps {
    children: React.ReactNode;
    tabKey: string; // used as React key to trigger re-mount animation
}

/**
 * PageTransition — wraps each page view with a slide + fade entrance.
 * The `key` on this component causes React to unmount/remount on tab
 * change, triggering the CSS animation fresh each time.
 */
const PageTransition: React.FC<PageTransitionProps> = ({ children }) => (
    <div
        className="flex flex-col flex-1 min-h-0"
        style={{ animation: 'slide-fade-in 0.28s cubic-bezier(0.16,1,0.3,1) both' }}
    >
        {children}
    </div>
);

export default PageTransition;
