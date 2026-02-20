import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Rss } from "lucide-react";
import { toast } from "sonner";

interface FeedUrlCardProps {
  feedUrl: string;
}

const FeedUrlCard = ({ feedUrl }: FeedUrlCardProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Feed URL copied!");
  };

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 backdrop-blur-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <Rss className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">ATS Feed URL</span>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-background/70 border border-border/60 rounded-lg px-3 py-2 text-xs font-mono truncate">
          {feedUrl}
        </code>
        <Button variant="outline" size="sm" onClick={handleCopy} className="border-primary/30 hover:bg-primary/10">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2">Submit this URL to job boards that support XML feed imports.</p>
    </div>
  );
};

export default FeedUrlCard;
