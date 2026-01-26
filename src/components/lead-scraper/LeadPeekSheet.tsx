import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
    Mail,
    Linkedin,
    Brain,
    Building2,
    MapPin,
    Briefcase,
    Calendar,
    ExternalLink,
} from "lucide-react";
import type { LinkedInLead } from "./LeadTable"; // We will rename/refactor this type later, likely importing from a central types file or EliteLeadGrid

// Re-defining interface locally if needed to avoid circular deps during migration
// Ideally this should be shared. For now, assuming standard LinkedInLead shape.
interface LeadPeekSheetProps {
    lead: LinkedInLead | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRunDeepSearch: (lead: LinkedInLead) => void;
    isDeepSearchRunning?: boolean;
}

export const LeadPeekSheet = ({
    lead,
    open,
    onOpenChange,
    onRunDeepSearch,
    isDeepSearchRunning = false,
}: LeadPeekSheetProps) => {
    if (!lead) return null;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[400px] sm:w-[540px] p-0 flex flex-col h-full border-l border-border/50 bg-background/95 backdrop-blur-md shadow-2xl">
                {/* Header Section */}
                <div className="p-6 border-b border-border/40 bg-muted/20">
                    <SheetHeader className="space-y-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-1">
                                <SheetTitle className="text-2xl font-semibold tracking-tight">
                                    {lead.candidate_name}
                                </SheetTitle>
                                <SheetDescription className="flex items-center gap-2 text-base">
                                    <Briefcase className="w-4 h-4 text-primary" />
                                    {lead.job_title || "Unknown Title"}
                                </SheetDescription>
                            </div>
                            {lead.experience_level && (
                                <Badge variant="secondary" className="px-3 py-1 text-xs uppercase tracking-wider font-medium">
                                    {lead.experience_level}
                                </Badge>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                            {lead.company && (
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border border-border/50">
                                    <Building2 className="w-3.5 h-3.5" />
                                    {lead.company}
                                </div>
                            )}
                            {lead.location && (
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border border-border/50">
                                    <MapPin className="w-3.5 h-3.5" />
                                    {lead.location}
                                </div>
                            )}
                        </div>
                    </SheetHeader>

                    {/* Action Bar */}
                    <div className="flex gap-2 mt-6">
                        <Button
                            className="flex-1 gap-2 shadow-sm"
                            onClick={() => onRunDeepSearch(lead)}
                            disabled={isDeepSearchRunning}
                        >
                            <Brain className="w-4 h-4" />
                            {isDeepSearchRunning ? "Running Analysis..." : "Run Deep Search"}
                        </Button>

                        {lead.linkedin_url && (
                            <Button variant="outline" size="icon" asChild>
                                <a
                                    href={lead.linkedin_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="View LinkedIn Profile"
                                >
                                    <Linkedin className="w-4 h-4" />
                                </a>
                            </Button>
                        )}

                        {lead.contact_email && (
                            <Button variant="outline" size="icon" asChild>
                                <a href={`mailto:${lead.contact_email}`} title="Send Email">
                                    <Mail className="w-4 h-4" />
                                </a>
                            </Button>
                        )}
                    </div>
                </div>

                {/* Scrollable Content */}
                <ScrollArea className="flex-1">
                    <div className="p-6 space-y-8">
                        {/* About / Bio Placeholder if avail, or Skills */}
                        <div className="space-y-3">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                                Identified Skills
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {lead.keywords && lead.keywords.length > 0 ? (
                                    lead.keywords.map((skill, idx) => (
                                        <Badge
                                            key={idx}
                                            variant="outline"
                                            className="bg-primary/5 hover:bg-primary/10 transition-colors border-primary/20 text-primary"
                                        >
                                            {skill}
                                        </Badge>
                                    ))
                                ) : (
                                    <p className="text-sm text-muted-foreground italic">No specific skills tags found.</p>
                                )}
                            </div>
                        </div>

                        <Separator className="bg-border/40" />

                        {/* Metadata */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                                Discovery Details
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                                        <Calendar className="w-3.5 h-3.5" />
                                        Scraped Date
                                    </span>
                                    <p className="text-sm font-medium">
                                        {new Date(lead.scraped_at).toLocaleDateString(undefined, {
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric'
                                        })}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                                        <Briefcase className="w-3.5 h-3.5" />
                                        Session Source
                                    </span>
                                    <p className="text-sm font-medium truncate" title={lead.session_id || "Direct"}>
                                        {lead.session_id ? "Batch Search" : "Manual / Direct"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
};
