import { ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { X } from 'lucide-react';

interface SlideOverPanelProps {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children: ReactNode;
    width?: 'md' | 'lg' | 'xl';
    footer?: ReactNode;
}

const widthMap = {
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl',
};

const SlideOverPanel = ({ open, onClose, title, description, children, width = 'lg', footer }: SlideOverPanelProps) => {
    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent className={`${widthMap[width]} flex flex-col p-0 gap-0 border-l border-border bg-background`}>
                {/* Header */}
                <SheetHeader className="px-6 py-4 border-b border-border flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <SheetTitle className="text-lg font-bold text-foreground">{title}</SheetTitle>
                            {description && <SheetDescription className="text-sm text-muted-foreground mt-0.5">{description}</SheetDescription>}
                        </div>
                        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </SheetHeader>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="px-6 py-4 border-t border-border flex-shrink-0 bg-muted/30">
                        {footer}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
};

export default SlideOverPanel;
