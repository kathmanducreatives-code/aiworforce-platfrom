import { useState } from "react";
import { Search, Download, Brain, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ICPLeadCard, type ICPLead } from "./ICPLeadCard";
import { CandidateDetailModal } from "./CandidateDetailModal";

interface ICPLeadsGalleryProps {
    leads: ICPLead[];
    isLoading: boolean;
    onExport: () => void;
    lookalikeName?: string; // Metadata for the header
}

export const ICPLeadsGallery = ({
    leads,
    isLoading,
    onExport,
    lookalikeName = "Sophie Kay"
}: ICPLeadsGalleryProps) => {

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedLead, setSelectedLead] = useState<ICPLead | null>(null);

    // Client-side filtering
    const filteredLeads = leads.filter(lead =>
        lead.candidate_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.job_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.company?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleLeadClick = (lead: ICPLead) => {
        setSelectedLead(lead);
    };

    const handleNextLead = () => {
        if (!selectedLead) return;
        const idx = filteredLeads.findIndex(l => l.id === selectedLead.id);
        if (idx >= 0 && idx < filteredLeads.length - 1) {
            setSelectedLead(filteredLeads[idx + 1]);
        }
    };

    const handlePrevLead = () => {
        if (!selectedLead) return;
        const idx = filteredLeads.findIndex(l => l.id === selectedLead.id);
        if (idx > 0) {
            setSelectedLead(filteredLeads[idx - 1]);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground font-sans">

            {/* 1. Sticky Control Bar */}
            <header className="sticky top-14 z-30 bg-background/80 backdrop-blur-md border-b border-border px-6 py-3 flex items-center justify-between">

                {/* Left: Metadata Badge */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full pl-2 pr-3 py-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-xs font-mono text-primary uppercase tracking-wide">
                            DNA Source: {lookalikeName}
                        </span>
                    </div>
                </div>

                {/* Center: Search */}
                <div className="flex-1 max-w-md mx-6 relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                        placeholder="Search within results..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-card border-border focus-visible:ring-primary/50 focus-visible:border-primary/50 pl-9 rounded-xl h-9 text-sm"
                    />
                </div>

                {/* Right: Actions */}
                <Button
                    onClick={onExport}
                    variant="outline"
                    size="sm"
                    className="bg-[#161616] border-white/10 text-white hover:bg-[#00FF85]/10 hover:border-[#00FF85]/30 hover:text-[#00FF85] transition-all"
                >
                    <Download className="w-4 h-4 mr-2" />
                    Export All
                </Button>
            </header>

            {/* 2. Gallery Grid */}
            <main className="max-w-[1800px] mx-auto p-6">

                {isLoading ? (
                    <div className="space-y-6">
                        {/* Loading Progress */}
                        <div className="flex flex-col items-center justify-center py-12 space-y-4">
                            <div className="relative w-16 h-16">
                                <div className="absolute inset-0 border-t-2 border-[#00FF85] rounded-full animate-spin" />
                                <div className="absolute inset-2 border-r-2 border-[#00FF85]/50 rounded-full animate-spin reverse" />
                                <Brain className="absolute inset-0 m-auto w-6 h-6 text-[#00FF85] animate-pulse" />
                            </div>
                            <p className="text-[#00FF85] font-mono text-sm animate-pulse">
                                Analyzing LinkedIn DNA... [65%]
                            </p>
                        </div>

                        {/* Skeleton Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="h-[280px] bg-[#161616] border border-white/5 rounded-xl p-4 space-y-4">
                                    <div className="flex gap-3">
                                        <Skeleton className="w-10 h-10 rounded-full bg-white/5" />
                                        <div className="space-y-2 flex-1">
                                            <Skeleton className="h-4 w-3/4 bg-white/5" />
                                            <Skeleton className="h-3 w-1/2 bg-white/5" />
                                        </div>
                                    </div>
                                    <Skeleton className="h-16 w-full rounded-lg bg-white/5" />
                                    <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : filteredLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <Brain className="w-12 h-12 mb-4 opacity-20" />
                        <p>No matches found matching your filters.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {filteredLeads.map((lead) => (
                            <ICPLeadCard
                                key={lead.id}
                                lead={lead}
                                onClick={() => handleLeadClick(lead)}
                            />
                        ))}
                    </div>
                )}
            </main>

            {/* Detail Modal Integration */}
            <CandidateDetailModal
                lead={selectedLead as any} // Compatible type
                isOpen={!!selectedLead}
                onClose={() => setSelectedLead(null)}
                onNext={handleNextLead}
                onPrev={handlePrevLead}
                hasNext={!!selectedLead && filteredLeads.indexOf(selectedLead) < filteredLeads.length - 1}
                hasPrev={!!selectedLead && filteredLeads.indexOf(selectedLead) > 0}
            />
        </div>
    );
};
