import { useState, useEffect } from "react";
import { ICPFormData } from "@/types/icp";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Brain, Search, Globe, Sparkles, Briefcase, Loader2, User, GraduationCap, Cpu, Layers, Code2, Zap } from "lucide-react";
import { INDUSTRIES } from "@/data/industries";
import { cn } from "@/lib/utils";

interface StrategyPreviewStepProps {
    value: ICPFormData;
    onChange: (data: ICPFormData) => void;
    sessionId?: string;
}

export const StrategyPreviewStep = ({ value, onChange, sessionId }: StrategyPreviewStepProps) => {
    const [typedStrategy, setTypedStrategy] = useState("");
    const [isTyping, setIsTyping] = useState(true);
    const [showAccordions, setShowAccordions] = useState(false);

    const fullStrategy = value.generated_strategy || "";
    const isRefining = !value.generated_strategy && !value.strategyData?.search_logic_dna;

    useEffect(() => {
        if (!fullStrategy || isRefining) {
            setIsTyping(false);
            return;
        }

        const startDelay = setTimeout(() => {
            let i = 0;
            const speed = 10;
            const interval = setInterval(() => {
                setTypedStrategy(fullStrategy.slice(0, i + 1));
                i++;
                if (i >= fullStrategy.length) {
                    clearInterval(interval);
                    setIsTyping(false);
                    setShowAccordions(true);
                }
            }, speed);
            return () => clearInterval(interval);
        }, 800);

        const accordionTimeout = setTimeout(() => setShowAccordions(true), 1500);

        return () => {
            clearTimeout(startDelay);
            clearTimeout(accordionTimeout);
        };
    }, [fullStrategy, isRefining]);

    const profile = value.lookalikeProfile;
    const education = profile?.education || [];

    const getIndustryLabel = (id: string | number) => {
        const numId = Number(id);
        if (isNaN(numId)) return String(id);
        return INDUSTRIES.find(i => i.id === numId)?.label || String(id);
    };

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
        <div className="flex flex-col h-full relative space-y-3">

            {/* Candidate Reference Card */}
            {profile && (
                <div className="animate-in slide-in-from-top-4 fade-in duration-700">
                    <div className="relative overflow-hidden rounded-2xl bg-card border border-border shadow-sm p-5">
                        {/* Subtle glow accent */}
                        <div className="absolute -top-8 -right-8 w-32 h-32 bg-primary/[0.06] blur-3xl rounded-full pointer-events-none" />
                        <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-blue-500/[0.04] blur-2xl rounded-full pointer-events-none" />

                        <div className="relative flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                            {/* Avatar */}
                            <div className="relative flex-shrink-0">
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/15 shadow-[0_0_20px_hsl(var(--primary)/0.08)]">
                                    {profile.photo_url ? (
                                        <img src={profile.photo_url} alt={profile.name} className="w-full h-full rounded-2xl object-cover" />
                                    ) : (
                                        <User className="w-6 h-6 text-primary/70" />
                                    )}
                                </div>
                                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-[0_0_8px_hsl(var(--primary)/0.5)]">
                                    <Zap className="w-3 h-3 text-primary-foreground" />
                                </div>
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2.5 flex-wrap">
                                    <h4 className="text-foreground font-semibold text-base tracking-tight">{profile.name}</h4>
                                    <Badge className="bg-primary/10 text-primary border border-primary/20 text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 shadow-[0_0_6px_hsl(var(--primary)/0.15)]">
                                        Analyzed Reference
                                    </Badge>
                                </div>
                                <p className="text-muted-foreground text-sm font-medium">{profile.current_title}</p>
                                {education.length > 0 && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground/70 animate-in fade-in duration-700" style={{ animationDelay: '400ms' }}>
                                        <GraduationCap className="w-3.5 h-3.5 text-muted-foreground/50" />
                                        <span className="truncate max-w-[300px]">{education[0].school || education[0].institution_name}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Strategy Output Block */}
            <div className="animate-in fade-in slide-in-from-bottom-3 duration-700 delay-500 fill-mode-forwards opacity-0" style={{ animationDelay: '500ms' }}>
                <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    {/* Top accent bar */}
                    <div className="h-[2px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

                    {/* Decorative glow */}
                    <div className="absolute top-0 right-0 -mt-6 -mr-6 w-28 h-28 bg-primary/[0.07] blur-3xl rounded-full pointer-events-none animate-pulse" />

                    <div className="relative z-10 p-6">
                        <div className="flex items-center gap-2.5 mb-4">
                            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/15">
                                <Brain className="w-4 h-4 text-primary" />
                            </div>
                            <span className="text-xs font-bold tracking-[0.15em] uppercase text-primary/80">Generated Strategy</span>
                        </div>

                        {isRefining ? (
                            <div className="flex items-center gap-3 py-10">
                                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                <span className="text-lg font-medium text-foreground/60 animate-pulse">Refining Strategy...</span>
                            </div>
                        ) : (
                            <div className="min-h-[80px]">
                                <Textarea
                                    value={isTyping ? typedStrategy : (value.generated_strategy || typedStrategy)}
                                    onChange={(e) => onChange({ ...value, generated_strategy: e.target.value })}
                                    className={cn(
                                        "text-base md:text-lg font-medium leading-[1.7] text-foreground/90 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none p-0 h-auto w-full placeholder:text-foreground/20",
                                        isTyping && "after:content-['|'] after:animate-blink after:text-primary"
                                    )}
                                    placeholder="Strategy will appear here..."
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Technical Accordions */}
            <div className={cn(
                "flex-1 min-h-0 overflow-y-auto transition-all duration-700",
                showAccordions ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            )}>
                <Accordion type="single" collapsible defaultValue="item-1" className="space-y-3">

                    {/* Search Logic DNA */}
                    <AccordionItem value="item-1" className="border border-border rounded-2xl bg-card shadow-sm overflow-hidden data-[state=open]:border-primary/20 data-[state=open]:shadow-[0_0_20px_hsl(var(--primary)/0.04)] transition-all duration-300">
                        <AccordionTrigger className="px-5 py-4 hover:bg-accent/30 hover:no-underline [&[data-state=open]]:bg-primary/[0.03]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/10">
                                    <Search className="w-4 h-4" />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-semibold text-sm text-foreground/90">Search Logic DNA</h4>
                                    <p className="text-xs text-muted-foreground/70">Core query parameters</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-5 pb-5 pt-2">
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
                                                    ...value.strategyData!,
                                                    search_logic_dna: newDna
                                                }
                                            });
                                        }}
                                        className="bg-muted/30 border-border focus-visible:ring-primary/40 min-h-[120px] resize-y font-mono text-xs leading-relaxed tracking-wide text-primary drop-shadow-[0_0_2px_hsl(var(--primary)/0.3)] selection:bg-primary/30 rounded-xl"
                                        spellCheck={false}
                                        placeholder="// Search Logic DNA will be generated here..."
                                    />
                                    <div className="absolute bottom-3 right-3">
                                        <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/15 rounded-lg shadow-[0_0_10px_hsl(var(--primary)/0.08)]">
                                            <Sparkles className="w-3 h-3" />
                                            Refine with AI
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* Firmographic Constraints */}
                    <AccordionItem value="item-2" className="border border-border rounded-2xl bg-card shadow-sm overflow-hidden data-[state=open]:border-purple-500/20 data-[state=open]:shadow-[0_0_20px_rgba(168,85,247,0.04)] transition-all duration-300">
                        <AccordionTrigger className="px-5 py-4 hover:bg-accent/30 hover:no-underline [&[data-state=open]]:bg-purple-500/[0.03]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/10">
                                    <Globe className="w-4 h-4" />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-semibold text-sm text-foreground/90">Firmographic Constraints</h4>
                                    <p className="text-xs text-muted-foreground/70">Target filters & exclusions</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-5 pb-5 pt-2">
                            <div className="flex flex-wrap gap-2">
                                {value.strategyData?.firmographic_constraints && Object.keys(value.strategyData.firmographic_constraints).length > 0 ? (
                                    Object.entries(value.strategyData.firmographic_constraints).map(([key, val]) => (
                                        <Badge key={key} variant="outline" className="h-8 pl-2.5 pr-3 gap-1.5 bg-accent/40 hover:bg-accent/60 border-border transition-colors cursor-default rounded-lg">
                                            {key.includes('location') || key.includes('geo') ? <span className="text-purple-400"><Globe className="w-3.5 h-3.5" /></span> :
                                                key.includes('size') || key.includes('employees') ? <span className="text-blue-400"><Layers className="w-3.5 h-3.5" /></span> :
                                                    key.includes('industry') ? <span className="text-pink-400"><Briefcase className="w-3.5 h-3.5" /></span> :
                                                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                                            }
                                            <span className="capitalize text-muted-foreground/80 text-xs">{key.replace(/_/g, ' ')}:</span>
                                            <span className="text-foreground font-medium text-xs">{String(val)}</span>
                                        </Badge>
                                    ))
                                ) : (
                                    <>
                                        {value.company_location && value.company_location.length > 0 && (
                                            <Badge variant="outline" className="h-8 pl-2.5 pr-3 gap-1.5 bg-accent/40 border-border rounded-lg">
                                                <span className="text-purple-400"><Globe className="w-3.5 h-3.5" /></span>
                                                <span className="text-muted-foreground/80 text-xs">Location:</span>
                                                <span className="text-foreground text-xs">{value.company_location.join(", ")}</span>
                                            </Badge>
                                        )}
                                        {value.company_size && (
                                            <Badge variant="outline" className="h-8 pl-2.5 pr-3 gap-1.5 bg-accent/40 border-border rounded-lg">
                                                <span className="text-blue-400"><Layers className="w-3.5 h-3.5" /></span>
                                                <span className="text-muted-foreground/80 text-xs">Size:</span>
                                                <span className="text-foreground text-xs">{value.company_size}</span>
                                            </Badge>
                                        )}
                                        {value.hiringIntensity && (
                                            <Badge variant="outline" className="h-8 pl-2.5 pr-3 gap-1.5 bg-accent/40 border-border rounded-lg">
                                                <span className="text-green-400"><Sparkles className="w-3.5 h-3.5" /></span>
                                                <span className="text-muted-foreground/80 text-xs">Hiring:</span>
                                                <span className="text-foreground text-xs">{value.hiringIntensity}</span>
                                            </Badge>
                                        )}
                                        {value.industries.map(id => (
                                            <Badge key={id} variant="outline" className="h-8 pl-2.5 pr-3 gap-1.5 bg-accent/40 border-border rounded-lg">
                                                <span className="text-pink-400"><Briefcase className="w-3.5 h-3.5" /></span>
                                                <span className="text-muted-foreground/80 text-xs">Industry:</span>
                                                <span className="text-foreground text-xs">{getIndustryLabel(id)}</span>
                                            </Badge>
                                        ))}
                                    </>
                                )}
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* Technical Execution */}
                    <AccordionItem value="item-3" className="border border-border rounded-2xl bg-card shadow-sm overflow-hidden data-[state=open]:border-orange-500/20 data-[state=open]:shadow-[0_0_20px_rgba(249,115,22,0.04)] transition-all duration-300">
                        <AccordionTrigger className="px-5 py-4 hover:bg-accent/30 hover:no-underline [&[data-state=open]]:bg-orange-500/[0.03]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/10">
                                    <Cpu className="w-4 h-4" />
                                </div>
                                <div className="text-left">
                                    <h4 className="font-semibold text-sm text-foreground/90">Technical Execution</h4>
                                    <p className="text-xs text-muted-foreground/70">JSON payload logic</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-5 pb-5 pt-2">
                            <div className="relative rounded-xl bg-muted/20 border border-border overflow-hidden">
                                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-accent/10">
                                    <Code2 className="w-3.5 h-3.5 text-muted-foreground/50" />
                                    <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">execution_payload.json</span>
                                </div>
                                <div className="p-4 font-mono text-xs text-primary/80 overflow-x-auto leading-relaxed max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                                    <pre>{JSON.stringify(value.strategyData?.technical_execution || jsonPreview, null, 2)}</pre>
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        </div>
    );
};
