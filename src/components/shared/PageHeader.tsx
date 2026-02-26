import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Breadcrumb {
    label: string;
    href?: string;
}

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    breadcrumbs?: Breadcrumb[];
    primaryAction?: {
        label: string;
        onClick: () => void;
        icon?: ReactNode;
    };
    secondaryActions?: {
        label: string;
        onClick: () => void;
        icon?: ReactNode;
        variant?: 'outline' | 'ghost';
    }[];
    children?: ReactNode;
}

const PageHeader = ({ title, subtitle, breadcrumbs, primaryAction, secondaryActions, children }: PageHeaderProps) => {
    const navigate = useNavigate();

    return (
        <div className="mb-6 sm:mb-8">
            {/* Breadcrumbs */}
            {breadcrumbs && breadcrumbs.length > 0 && (
                <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
                    {breadcrumbs.map((crumb, i) => (
                        <span key={i} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
                            {crumb.href ? (
                                <button onClick={() => navigate(crumb.href!)} className="hover:text-foreground transition-colors">
                                    {crumb.label}
                                </button>
                            ) : (
                                <span className="text-foreground font-medium">{crumb.label}</span>
                            )}
                        </span>
                    ))}
                </nav>
            )}

            {/* Title row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">{title}</h1>
                    {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    {secondaryActions?.map((action, i) => (
                        <Button key={i} variant={action.variant || 'outline'} size="sm" onClick={action.onClick}
                            className="gap-1.5 rounded-lg border-border hover:border-primary/40 hover:bg-primary/5 transition-all">
                            {action.icon}
                            {action.label}
                        </Button>
                    ))}
                    {primaryAction && (
                        <Button size="sm" onClick={primaryAction.onClick}
                            className="gap-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all">
                            {primaryAction.icon}
                            {primaryAction.label}
                        </Button>
                    )}
                </div>
            </div>

            {/* Optional children slot */}
            {children && <div className="mt-4">{children}</div>}
        </div>
    );
};

export default PageHeader;
