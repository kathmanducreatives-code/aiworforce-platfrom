import { Badge } from "@/components/ui/badge";

export default function NewJobsBadge({ count }: { count: number }) {
    if (count === 0) return null;
    return (
        <Badge className="bg-primary/20 text-primary hover:bg-primary/30 ml-2">
            {count} New This Week
        </Badge>
    );
}
