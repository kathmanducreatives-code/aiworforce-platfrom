import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface NameSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
  isLoading: boolean;
}

export const NameSearchDialog = ({
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: NameSearchDialogProps) => {
  const [searchName, setSearchName] = useState("");

  const handleConfirm = () => {
    if (searchName.trim()) {
      onConfirm(searchName.trim());
      setSearchName("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-primary" />
            Name Your Search
          </DialogTitle>
          <DialogDescription>
            Give this search a memorable name. All scraped leads will be saved in a folder with this name.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="search-name">Search Name</Label>
            <Input
              id="search-name"
              placeholder="e.g., Senior Engineers - Bay Area"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchName.trim()) {
                  handleConfirm();
                }
              }}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!searchName.trim() || isLoading}
            className="bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Starting...
              </div>
            ) : (
              "Start Scraping"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
