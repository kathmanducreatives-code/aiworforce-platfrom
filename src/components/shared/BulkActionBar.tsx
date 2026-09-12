import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BulkAction {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
    variant?: 'default' | 'destructive' | 'outline';
}

interface BulkActionBarProps {
    selectedCount: number;
    onClearSelection: () => void;
    actions: BulkAction[];
    className?: string;
}

const BulkActionBar = ({ selectedCount, onClearSelection, actions, className }: BulkActionBarProps) => {
    if (selectedCount === 0) return null;

    return (
        <div className={cn(
            'ag-raised ag-edge-light sticky top-0 z-30 flex items-center gap-3 px-4 py-2.5 mb-4 rounded-xl',
            'animate-in slide-in-from-top-2 duration-200',
            className
        )}>
            <span className="text-sm font-medium text-foreground tabular-nums">
                {selectedCount} selected
            </span>

            <div className="h-4 w-px bg-border" />

            <div className="flex items-center gap-2 flex-1">
                {actions.map((action, i) => (
                    <Button
                        key={i}
                        size="sm"
                        variant={action.variant === 'destructive' ? 'destructive' : action.variant === 'outline' ? 'outline' : 'default'}
                        onClick={action.onClick}
                        className="gap-1.5 text-xs h-7"
                    >
                        {action.icon}
                        {action.label}
                    </Button>
                ))}
            </div>

            <button onClick={onClearSelection} className="p-1 rounded-md hover:bg-background/50 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
};

export default BulkActionBar;
