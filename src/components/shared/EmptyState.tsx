import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
    icon?: ReactNode;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    actionIcon?: ReactNode;
}

const EmptyState = ({ icon, title, description, actionLabel, onAction, actionIcon }: EmptyStateProps) => {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border flex items-center justify-center mb-5">
                {icon || <Inbox className="h-7 w-7 text-muted-foreground/60" />}
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1.5">{title}</h3>
            <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-6">{description}</p>
            {actionLabel && onAction && (
                <Button onClick={onAction} size="sm" className="gap-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground">
                    {actionIcon}
                    {actionLabel}
                </Button>
            )}
        </div>
    );
};

export default EmptyState;
