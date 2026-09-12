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
            <div className="ag-empty-mark w-14 h-14 mb-6 [&_svg]:h-6 [&_svg]:w-6">
                {icon || <Inbox />}
            </div>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground mb-1.5">{title}</h3>
            <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-6">{description}</p>
            {actionLabel && onAction && (
                <Button onClick={onAction} size="sm" className="gap-1.5">
                    {actionIcon}
                    {actionLabel}
                </Button>
            )}
        </div>
    );
};

export default EmptyState;
