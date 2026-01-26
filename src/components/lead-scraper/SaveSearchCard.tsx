import { useState, useEffect } from "react";
import { Bookmark, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SaveSearchCardProps {
  sessionId: string;
  currentName: string;
  onSave: (name: string) => Promise<void>;
  onDismiss: () => void;
}

export function SaveSearchCard({
  currentName,
  onSave,
  onDismiss,
}: SaveSearchCardProps) {
  const [name, setName] = useState(currentName);
  const [isSaving, setIsSaving] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  useEffect(() => {
    const id = setTimeout(() => setEntered(true), 20);
    return () => clearTimeout(id);
  }, []);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={`rounded-xl border border-primary/20 bg-card/90 backdrop-blur-sm shadow-sm overflow-hidden transition-all duration-300 ease-out ${
        entered ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      }`}
    >
      <div className="p-4 lg:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bookmark className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Name this search</h3>
              <p className="text-xs text-muted-foreground">
                Save with a custom name to find it easily in Saved Searches
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="save-search-name" className="text-xs font-medium">
              Search name
            </Label>
            <Input
              id="save-search-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="e.g. Senior Engineers - Bay Area"
              className="h-9 text-sm"
              disabled={isSaving}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!name.trim() || isSaving}
              className="gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={onDismiss} disabled={isSaving}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
