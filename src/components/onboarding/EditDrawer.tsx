// Edit drawer for progressive onboarding. Editing a scene NEVER turns the whole
// slide into a form — instead a right-side glass drawer slides in with the
// relevant chip editors. The drawer is the one place an internal scrollbar is
// allowed (long chip lists), keeping the main scene calm and scroll-free.

import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

export function EditDrawer({
  open, onOpenChange, title, description, children, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  onDone?: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-border/50 bg-card/80 backdrop-blur-2xl sm:max-w-md"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-lg tracking-tight">{title}</SheetTitle>
          {description && <SheetDescription className="text-xs">{description}</SheetDescription>}
        </SheetHeader>

        <div className="-mr-2 mt-4 flex-1 space-y-5 overflow-y-auto pr-2">{children}</div>

        <SheetFooter className="mt-4">
          <Button onClick={() => { onDone?.(); onOpenChange(false); }} className="w-full">
            Save changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
