import { useState, useEffect } from "react";
import { ICPFormData } from "@/types/icp";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Brain, Search, Database, Layers, Cpu, Globe, Sparkles, Briefcase, Loader2, User, GraduationCap } from "lucide-react";
import { INDUSTRIES } from "@/data/industries";
import { cn } from "@/lib/utils";

interface StrategyPreviewStepProps {
    value: ICPFormData;
    onChange: (data: ICPFormData) => void;
    sessionId?: string;
}

export const StrategyPreviewStep = ({ value, onChange, sessionId }: StrategyPreviewStepProps) => {
    // Typewriter State
    const [typedStrategy, setTypedStrategy] = useState("");
    const [isTyping, setIsTyping] = useState(true);
    const [showAccordions, setShowAccordions] = useState(false);

    // Initial Full Text
    const fullStrategy = value.generated_strategy || "";
    // If empty, show placeholder state handled below, but if present, type it out.
    // If it's already "Refining...", don't type it, just pulse.
    const isRefining = !value.generated_strategy && !value.strategyData?.search_logic_dna;

    useEffect(() => {
        if (!fullStrategy || isRefining) {
            setIsTyping(false);
            return;
        }

        // Start typing after a delay to allow Profile Reveal
        const startDelay = setTimeout(() => {
            let i = 0;
            const speed = 10; // ms per char
            const interval = setInterval(() => {
                setTypedStrategy(fullStrategy.slice(0, i + 1));
                i++;
                if (i >= fullStrategy.length) {
                    clearInterval(interval);
                    setIsTyping(false);
                    setShowAccordions(true); // Show accordions after typing done (or maybe start parallel?)
                    // Let's show accordions earlier to not block UI too long
                }
            }, speed);
            return () => clearInterval(interval);
        }, 800); // 800ms delay for profile reveal

        // Show accordions after 1.5s regardless of typing length so user isn't stuck
        const accordionTimeout = setTimeout(() => setShowAccordions(true), 1500);

        return () => {
            clearTimeout(startDelay);
            clearTimeout(accordionTimeout);
        };
    }, [fullStrategy, isRefining]);


    // Candidate Data for Reveal
    const profile = value.lookalikeProfile;
    const workHistory = profile?.work_history || [];
    const education = profile?.education || [];

    const getIndustryLabel = (id: string | number) => {
        const numId = Number(id);
        if (isNaN(numId)) return String(id);
        return INDUSTRIES.find(i => i.id === numId)?.label || String(id);
    };

    // Construct JSON preview for Technical Execution
    const jsonPreview = value.strategyData?.technical_execution || {
        boolean_logic: {
            must: {
                industries: value.industries,
                location: value.company_location || "Global"
            },
            should: {
                keywords: value.candidate_requirements?.split(" ").slice(0, 5) || [],
                lookalike_vector: value.lookalikeProfile?.name || "null"
            },
            filter: {
                size: value.company_size
            }
        },
        execution_mode: "deep_scrape"
    };

    return (
        <div className="flex flex-col h-full relative">

            {/* 0. Candidate Analysis Snapshot (Staggered Reveal) */}
            {profile && (
                <div className="flex-shrink-0 px-1 mb-6 animate-in slide-in-from-top-4 fade-in duration-700">
                    <div className="p-4 rounded-xl bg-[#161616]/80 border border-white/5 flex flex-col md:flex-row gap-4 items-start md:items-center">
                        <div className="w-12 h-12 rounded-full bg-[#00FF85]/10 flex items-center justify-center border border-[#00FF85]/20 flex-shrink-0">
                            {profile.photo_url ? (
                                <img src={profile.photo_url} alt={profile.name} className="w-full h-full rounded-full object-cover" />
                            ) : (
                                <User className="w-5 h-5 text-[#00FF85]" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="text-white font-medium truncate flex items-center gap-2">
                                {profile.name}
                                <Badge variant="secondary" className="bg-[#00FF85]/10 text-[#00FF85] border-none text-[10px] h-5">Analyzed Reference</Badge>
                            </h4>
                            <p className="text-muted-foreground text-sm truncate">{profile.headline || profile.current_title}</p>

                            {/* Education Reveal (Delayed) */}
                            {education.length > 0 && (
                                <div className="mt-2 flex items-center gap-2 text-xs text-gray-400 animate-in fade-in slide-in-from-left-2 duration-700 delay-300 fill-mode-forwards opacity-0" style={{ animationDelay: '300ms' }}>
                                    <GraduationCap className="w-3 h-3 text-gray-500" />
                                    <span className="truncate max-w-[300px]">{education[0].school || education[0].institution_name}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}


            {/* 1. Strategy Header */}
            <div className="flex-shrink-0 mb-6 px-1 animate-in fade-in slide-in-from-bottom-2 duration-700 delay-500 fill-mode-forwards opacity-0" style={{ animationDelay: '500ms' }}>
                <div className="relative overflow-hidden rounded-xl bg-[#0A0A0A] border border-[#00FF85]/20 p-6 shadow-2xl">
                    <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-[#00FF85]/10 blur-3xl rounded-full pointer-events-none animate-pulse" />
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-2 text-[#00FF85]">
                            <Brain className="w-5 h-5" />
                            <span className="text-sm font-semibold tracking-wider uppercase">Generated Strategy</span>
                        </div>
                        {/* Editable Strategy Text with Typewriter */}
                        {isRefining ? (
                            <div className="flex items-center gap-2 text-muted-foreground py-8">
                                <Loader2 className="w-5 h-5 animate-spin text-[#00FF85]" />
                                <span className="text-xl font-medium animate-pulse">Refining Strategy...</span>
                            </div>
                        ) : (
                            <div className="min-h-[100px]">
                                <Textarea
                                    value={isTyping ? typedStrategy : (value.generated_strategy || typedStrategy)}
                                    onChange={(e) => onChange({ ...value, generated_strategy: e.target.value })}
                                    className={cn(
                                        "text-xl md:text-2xl font-bold leading-relaxed text-foreground bg-transparent border-none focus-visible:ring-0 resize-none p-0 h-auto w-full",
                                        isTyping && "after:content-['|'] after:animate-blink after:text-[#00FF85]"
                                    )}
                                    placeholder="Strategy will appear here..."
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 2. Accordion Console */}
            <div className={cn(
                "flex-1 min-h-0 overflow-y-auto px-1 transition-all duration-700 delay-700",
                showAccordions ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            )}>
                <Accordion type="single" collapsible defaultValue="item-1" className="space-y-4">

                    {/* Dropdown 1: Search Logic DNA */}
                    <AccordionItem value="item-1" className="border border-white/10 rounded-xl bg-[#0A0A0A] overflow-hidden data-[state=open]:border-[#00FF85]/30 transition-all duration-300">
                        <AccordionTrigger className="px-4 py-3 hover:bg-white/5 hover:no-underline [&[data-state=open]]:bg-[#00FF85]/5">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
                                    <Search className="w-4 h-4" />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-semibold text-sm">Search Logic DNA</h4>
                                    <p className="text-xs text-muted-foreground">Core query parameters</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 pt-2">
                            <div className="space-y-3">
                                <div className="relative">
                                    <Textarea
                                        value={value.strategyData?.search_logic_dna || value.final_query || ""}
                                        onChange={(e) => {
                                            const newDna = e.target.value;
                                            onChange({
                                                ...value,
                                                final_query: newDna,
                                                strategyData: {
                                                    ...value.strategyData!, // assume exists if we are editable
                                                    search_logic_dna: newDna
                                                }
                                            });
                                        }}
                                        className="bg-black/80 border-white/10 ring-1 ring-white/5 focus-visible:ring-[#00FF9D]/50 min-h-[120px] resize-y font-mono text-sm leading-relaxed tracking-wide text-[#00FF9D] drop-shadow-[0_0_2px_rgba(0,255,157,0.4)] font-medium selection:bg-[#00FF9D]/30"
                                        spellCheck={false}
                                        placeholder="// Search Logic DNA will be generated here...
(e.g., site:linkedin.com/in/ AND ...)"
                                    />
                                    <div className="absolute bottom-2 right-2">
                                        <Button size="sm" variant="secondary" className="h-7 text-xs gap-1 bg-[#00FF9D]/10 hover:bg-[#00FF9D]/20 text-[#00FF9D] border border-[#00FF9D]/20">
                                            <Sparkles className="w-3 h-3" />
                                            Refine with AI
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* Dropdown 2: Firmographic Constraints */}
                    <AccordionItem value="item-2" className="border border-white/10 rounded-xl bg-black/40 backdrop-blur-sm overflow-hidden data-[state=open]:border-primary/30 transition-all duration-300">
                        <AccordionTrigger className="px-4 py-3 hover:bg-white/5 hover:no-underline [&[data-state=open]]:bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
                                    <Globe className="w-4 h-4" />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-semibold text-sm">Firmographic Constraints</h4>
                                    <p className="text-xs text-muted-foreground">Target filters & exclusions</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 pt-2">
                            <div className="flex flex-wrap gap-2">
                                {value.strategyData?.firmographic_constraints && Object.keys(value.strategyData.firmographic_constraints).length > 0 ? (
                                    Object.entries(value.strategyData.firmographic_constraints).map(([key, val]) => (
                                        <Badge key={key} variant="outline" className="h-8 pl-2 pr-3 gap-1.5 bg-white/5 hover:bg-white/10 border-white/10 transition-colors cursor-default">
                                            {/* Icon Logic based on key */}
                                            {key.includes('location') || key.includes('geo') ? <span className="text-purple-400"><Globe className="w-3.5 h-3.5" /></span> :
                                                key.includes('size') || key.includes('employees') ? <span className="text-blue-400"><Layers className="w-3.5 h-3.5" /></span> :
                                                    key.includes('industry') ? <span className="text-pink-400"><Briefcase className="w-3.5 h-3.5" /></span> :
                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                            }
                                            <span className="capitalize text-muted-foreground">{key.replace(/_/g, ' ')}:</span>
                                            <span className="text-foreground font-medium">{String(val)}</span>
                                        </Badge>
                                    ))
                                ) : (
                                    <>
                                        {/* Fallback to formData fields if no strategyData - Explicit Display */}
                                        {value.company_location && value.company_location.length > 0 && (
                                            <Badge variant="outline" className="h-8 pl-2 pr-3 gap-1.5 bg-white/5 border-white/10">
                                                <span className="text-purple-400"><Globe className="w-3.5 h-3.5" /></span>
                                                <span className="text-muted-foreground">Location:</span>
                                                <span className="text-foreground">{value.company_location.join(", ")}</span>
                                            </Badge>
                                        )}

                                        {value.company_size && (
                                            <Badge variant="outline" className="h-8 pl-2 pr-3 gap-1.5 bg-white/5 border-white/10">
                                                <span className="text-blue-400"><Layers className="w-3.5 h-3.5" /></span>
                                                <span className="text-muted-foreground">Size:</span>
                                                <span className="text-foreground">{value.company_size}</span>
                                            </Badge>
                                        )}

                                        {value.hiringIntensity && (
                                            <Badge variant="outline" className="h-8 pl-2 pr-3 gap-1.5 bg-white/5 border-white/10">
                                                <span className="text-green-400"><Sparkles className="w-3.5 h-3.5" /></span>
                                                <span className="text-muted-foreground">Hiring:</span>
                                                <span className="text-foreground">{value.hiringIntensity}</span>
                                            </Badge>
                                        )}

                                        {value.industries.map(id => (
                                            <Badge key={id} variant="outline" className="h-8 pl-2 pr-3 gap-1.5 bg-white/5 border-white/10">
                                                <span className="text-pink-400"><Briefcase className="w-3.5 h-3.5" /></span>
                                                <span className="text-muted-foreground">Industry:</span>
                                                <span className="text-foreground">{getIndustryLabel(id)}</span>
                                            </Badge>
                                        ))}
                                    </>
                                )}
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* Dropdown 3: Technical Execution */}
                    <AccordionItem value="item-3" className="border border-white/10 rounded-xl bg-black/40 backdrop-blur-sm overflow-hidden data-[state=open]:border-primary/30 transition-all duration-300">
                        <AccordionTrigger className="px-4 py-3 hover:bg-white/5 hover:no-underline [&[data-state=open]]:bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-orange-500/20 text-orange-400">
                                    <Cpu className="w-4 h-4" />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-semibold text-sm">Technical Execution</h4>
                                    <p className="text-xs text-muted-foreground">JSON payload logic</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 pt-2">
                            <div className="rounded-lg bg-black/50 p-4 font-mono text-xs text-green-400/90 overflow-x-auto border border-white/10">
                                <pre>{JSON.stringify(value.strategyData?.technical_execution || jsonPreview, null, 2)}</pre>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        </div>
    );
};
