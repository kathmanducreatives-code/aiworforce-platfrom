import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronDown, Search, Plus, Minus, X, Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 📌 INDUSTRY DATA SOURCE (STATIC)
// Use this constant as the single source of truth:
const INDUSTRY_CATEGORIES = [
    {
        category: "Technology & Software",
        categoryId: "tech",
        industries: [
            { name: "Computer Software", id: "4" },
            { name: "Information Technology and Services", id: "96" },
            { name: "IT Services and IT Consulting", id: "96" },
            { name: "Internet", id: "6" },
            { name: "Computer and Network Security", id: "123" },
            { name: "Computer Games", id: "118" },
            { name: "Computer Hardware", id: "119" },
            { name: "Computer Networking Products", id: "120" },
            { name: "Telecommunications", id: "8" },
            { name: "Wireless Services", id: "10" }
        ]
    },
    {
        category: "Staffing & Human Resources",
        categoryId: "staffing",
        industries: [
            { name: "Staffing and Recruiting", id: "104" },
            { name: "Human Resources Services", id: "137" }
        ]
    },
    {
        category: "Financial Services",
        categoryId: "finance",
        industries: [
            { name: "Financial Services", id: "43" },
            { name: "Banking", id: "41" },
            { name: "Investment Banking", id: "45" },
            { name: "Investment Management", id: "46" },
            { name: "Venture Capital and Private Equity Principals", id: "106" },
            { name: "Capital Markets", id: "129" },
            { name: "Insurance", id: "42" },
            { name: "Insurance Carriers", id: "1725" }
        ]
    },
    {
        category: "Consulting & Professional Services",
        categoryId: "consulting",
        industries: [
            { name: "Management Consulting", id: "11" },
            { name: "Business Consulting and Services", id: "100" },
            { name: "Legal Services", id: "10" },
            { name: "Accounting", id: "12" },
            { name: "Architecture and Planning", id: "73" },
            { name: "Design Services", id: "74" }
        ]
    },
    {
        category: "Marketing & Media",
        categoryId: "marketing",
        industries: [
            { name: "Marketing and Advertising", id: "80" },
            { name: "Advertising Services", id: "80" },
            { name: "Public Relations and Communications Services", id: "81" },
            { name: "Market Research", id: "18" },
            { name: "Media Production", id: "126" },
            { name: "Music", id: "127" },
            { name: "Publishing", id: "82" },
            { name: "Online Audio and Video Media", id: "83" },
            { name: "Broadcast Media Production and Distribution", id: "84" },
            { name: "Newspapers", id: "85" },
            { name: "Movies and Sound Recording", id: "86" }
        ]
    },
    {
        category: "Healthcare & Pharma",
        categoryId: "healthcare",
        industries: [
            { name: "Hospitals and Health Care", id: "14" },
            { name: "Medical Practices", id: "15" },
            { name: "Pharmaceutical Manufacturing", id: "15" },
            { name: "Biotechnology Research", id: "14" },
            { name: "Medical Device", id: "17" },
            { name: "Mental Health Care", id: "2057" }
        ]
    },
    {
        category: "Education",
        categoryId: "education",
        industries: [
            { name: "Education", id: "1999" },
            { name: "Higher Education", id: "68" },
            { name: "Primary and Secondary Education", id: "67" },
            { name: "E-Learning Providers", id: "132" },
            { name: "Professional Training and Coaching", id: "105" },
            { name: "Technical and Vocational Training", id: "2018" }
        ]
    },
    {
        category: "Real Estate & Construction",
        categoryId: "realestate",
        industries: [
            { name: "Real Estate", id: "44" },
            { name: "Construction", id: "48" },
            { name: "Civil Engineering", id: "51" },
            { name: "Building Construction", id: "406" }
        ]
    },
    {
        category: "Manufacturing",
        categoryId: "manufacturing",
        industries: [
            { name: "Manufacturing", id: "53" },
            { name: "Automotive", id: "56" },
            { name: "Motor Vehicle Manufacturing", id: "56" },
            { name: "Aviation and Aerospace Component Manufacturing", id: "54" },
            { name: "Industrial Machinery Manufacturing", id: "55" },
            { name: "Chemical Manufacturing", id: "19" },
            { name: "Appliances, Electrical, and Electronics Manufacturing", id: "23" }
        ]
    },
    {
        category: "Retail & E-Commerce",
        categoryId: "retail",
        industries: [
            { name: "Retail", id: "27" },
            { name: "E-Commerce", id: "111" },
            { name: "Consumer Goods", id: "25" },
            { name: "Wholesale", id: "134" },
            { name: "Retail Apparel and Fashion", id: "2291" }
        ]
    },
    {
        category: "Food & Hospitality",
        categoryId: "food",
        industries: [
            { name: "Food and Beverage Services", id: "34" },
            { name: "Restaurants", id: "32" },
            { name: "Hospitality", id: "31" },
            { name: "Hotels and Motels", id: "2194" },
            { name: "Food and Beverage Manufacturing", id: "25" }
        ]
    },
    {
        category: "Transportation & Logistics",
        categoryId: "transport",
        industries: [
            { name: "Transportation, Logistics, Supply Chain and Storage", id: "20" },
            { name: "Airlines and Aviation", id: "1933" },
            { name: "Maritime Transportation", id: "1939" },
            { name: "Truck Transportation", id: "1944" },
            { name: "Warehousing and Storage", id: "1946" }
        ]
    },
    {
        category: "Energy & Utilities",
        categoryId: "energy",
        industries: [
            { name: "Utilities", id: "59" },
            { name: "Electric Power Generation", id: "2107" },
            { name: "Oil and Gas", id: "57" },
            { name: "Renewable Energy Power Generation", id: "2111" }
        ]
    },
    {
        category: "Government & Nonprofit",
        categoryId: "government",
        industries: [
            { name: "Government Administration", id: "75" },
            { name: "Non-profit Organizations", id: "100" },
            { name: "Civic and Social Organizations", id: "90" },
            { name: "International Affairs", id: "1860" },
            { name: "Religious Institutions", id: "89" }
        ]
    },
    {
        category: "Entertainment & Sports",
        categoryId: "entertainment",
        industries: [
            { name: "Entertainment Providers", id: "28" },
            { name: "Performing Arts and Spectator Sports", id: "2130" },
            { name: "Spectator Sports", id: "33" },
            { name: "Wellness and Fitness Services", id: "124" },
            { name: "Sports Teams and Clubs", id: "2142" }
        ]
    },
    {
        category: "Administrative and Support Services",
        categoryId: "admin",
        industries: [
            { name: "Events Services", id: "110" },
            { name: "Security and Investigations", id: "121" },
            { name: "Facilities Services", id: "122" },
            { name: "Translation and Localization", id: "108" },
            { name: "Writing and Editing", id: "103" }
        ]
    },
    {
        category: "Consumer Services",
        categoryId: "consumer",
        industries: [
            { name: "Consumer Services", id: "91" },
            { name: "Personal and Laundry Services", id: "2258" },
            { name: "Repair and Maintenance", id: "2225" }
        ]
    }
];

interface TargetIndustrySelectorProps {
    includedIndustryIds: string[];
    excludedIndustryIds: string[];
    onChange: (included: string[], excluded: string[]) => void;
}

export const TargetIndustrySelector = ({
    includedIndustryIds,
    excludedIndustryIds,
    onChange
}: TargetIndustrySelectorProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const toggleCategory = (categoryId: string) => {
        setActiveCategory(prev => prev === categoryId ? null : categoryId);
    };

    const handleInclude = (id: string, isCategory: boolean = false, childIds: string[] = []) => {
        let newIncluded = [...includedIndustryIds];
        let newExcluded = [...excludedIndustryIds];

        const idsToProcess = isCategory ? childIds : [id];

        idsToProcess.forEach(targetId => {
            // Remove from excluded if present
            newExcluded = newExcluded.filter(eid => eid !== targetId);
            // Add to included if not present
            if (!newIncluded.includes(targetId)) {
                newIncluded.push(targetId);
            }
        });

        onChange(newIncluded, newExcluded);
    };

    const handleExclude = (id: string, isCategory: boolean = false, childIds: string[] = []) => {
        let newIncluded = [...includedIndustryIds];
        let newExcluded = [...excludedIndustryIds];

        const idsToProcess = isCategory ? childIds : [id];

        idsToProcess.forEach(targetId => {
            // Remove from included if present
            newIncluded = newIncluded.filter(iid => iid !== targetId);
            // Add to excluded if not present
            if (!newExcluded.includes(targetId)) {
                newExcluded.push(targetId);
            }
        });

        onChange(newIncluded, newExcluded);
    };

    const handleNeutral = (id: string, isCategory: boolean = false, childIds: string[] = []) => {
        let newIncluded = [...includedIndustryIds];
        let newExcluded = [...excludedIndustryIds];

        const idsToProcess = isCategory ? childIds : [id];

        idsToProcess.forEach(targetId => {
            newIncluded = newIncluded.filter(iid => iid !== targetId);
            newExcluded = newExcluded.filter(eid => eid !== targetId);
        });

        onChange(newIncluded, newExcluded);
    };

    // Helper to check state
    const getStatus = (id: string) => {
        if (includedIndustryIds.includes(id)) return 'included';
        if (excludedIndustryIds.includes(id)) return 'excluded';
        return 'neutral';
    };

    // Check category status (all children included? all excluded? mixed?)
    const getCategoryStatus = (childIds: string[]) => {
        const includedCount = childIds.filter(id => includedIndustryIds.includes(id)).length;
        const excludedCount = childIds.filter(id => excludedIndustryIds.includes(id)).length;

        if (includedCount === childIds.length && childIds.length > 0) return 'included';
        if (excludedCount === childIds.length && childIds.length > 0) return 'excluded';
        return 'neutral'; // mixed or none
    };

    const filteredCategories = useMemo(() => {
        if (!searchQuery.trim()) return INDUSTRY_CATEGORIES;
        return INDUSTRY_CATEGORIES.map(cat => ({
            ...cat,
            industries: cat.industries.filter(ind =>
                ind.name.toLowerCase().includes(searchQuery.toLowerCase())
            )
        })).filter(cat => cat.industries.length > 0);
    }, [searchQuery]);

    // Auto-open logic when searching
    useEffect(() => {
        if (searchQuery.trim() && filteredCategories.length > 0) {
            setIsOpen(true);
            if (filteredCategories.length === 1) {
                setActiveCategory(filteredCategories[0].categoryId);
            }
        }
    }, [searchQuery, filteredCategories]);

    const handleContainerClick = () => {
        if (!isOpen) {
            setIsOpen(true);
            inputRef.current?.focus();
        }
    };

    return (
        <div
            ref={containerRef}
            onClick={handleContainerClick}
            className={cn(
                "relative transition-all duration-300 ease-out-quart rounded-xl border bg-[#161616]",
                isOpen
                    ? "border-[#00FF85] shadow-[0_0_20px_rgba(0,255,133,0.2)] z-50 scale-[1.02]"
                    : "border-[#00FF85]/30 hover:border-[#00FF85]/60 hover:shadow-[0_0_15px_rgba(0,255,133,0.1)]"
            )}
        >
            {/* Header / Trigger Area */}
            <div className="flex flex-col gap-3 p-4 cursor-text">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 text-[#00FF85]">
                        <Briefcase className="w-5 h-5 shrink-0" />
                        <span className="text-sm font-bold tracking-wide uppercase">Target Industries</span>
                    </div>
                </div>

                {/* Selected Chips Area */}
                <div className="flex flex-wrap gap-2 min-h-[32px]">
                    {INDUSTRY_CATEGORIES.flatMap(c => c.industries).filter(i => includedIndustryIds.includes(i.id)).map(ind => (
                        <Badge key={ind.id} variant="secondary" className="gap-1 bg-[#00FF85]/10 text-[#00FF85] border-[#00FF85]/20 hover:bg-[#00FF85]/20 animate-in fade-in zoom-in-50 duration-200">
                            {ind.name}
                            <X
                                className="w-3 h-3 cursor-pointer ml-1 hover:text-white"
                                onClick={(e) => { e.stopPropagation(); handleNeutral(ind.id); }}
                            />
                        </Badge>
                    ))}
                    {INDUSTRY_CATEGORIES.flatMap(c => c.industries).filter(i => excludedIndustryIds.includes(i.id)).map(ind => (
                        <Badge key={ind.id} variant="destructive" className="gap-1 bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20 animate-in fade-in zoom-in-50 duration-200">
                            <Minus className="w-3 h-3 text-red-500" />
                            {ind.name}
                            <X
                                className="w-3 h-3 cursor-pointer ml-1 hover:text-white"
                                onClick={(e) => { e.stopPropagation(); handleNeutral(ind.id); }}
                            />
                        </Badge>
                    ))}

                    {/* Search Input inline with chips */}
                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 min-w-[140px] bg-transparent border-none text-sm text-white focus:outline-none placeholder:text-muted-foreground/50 h-8"
                        placeholder={includedIndustryIds.length === 0 && excludedIndustryIds.length === 0 ? "Search industries..." : ""}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {/* Dropdown Content */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="border-t border-white/5 overflow-hidden"
                    >
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2">
                            {filteredCategories.map(category => {
                                const isExpanded = activeCategory === category.categoryId;
                                const childIds = category.industries.map(i => i.id);
                                const status = getCategoryStatus(childIds);

                                return (
                                    <div key={category.categoryId} className="border-b border-white/5 last:border-0 rounded-lg overflow-hidden mb-1">
                                        {/* Category Header */}
                                        <div
                                            className={cn(
                                                "flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-white/5 transition-colors rounded-lg",
                                                isExpanded && "bg-white/5"
                                            )}
                                            onClick={(e) => { e.stopPropagation(); toggleCategory(category.categoryId); }}
                                        >
                                            <div className="flex items-center gap-2">
                                                <motion.div
                                                    animate={{ rotate: isExpanded ? 90 : 0 }}
                                                    transition={{ duration: 0.2 }}
                                                >
                                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                                </motion.div>
                                                <span className="text-sm font-medium text-white">{category.category}</span>
                                            </div>

                                            {/* Category Toggles */}
                                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                <ToggleGroup
                                                    status={status}
                                                    onInclude={() => handleInclude(category.categoryId, true, childIds)}
                                                    onExclude={() => handleExclude(category.categoryId, true, childIds)}
                                                    onNeutral={() => handleNeutral(category.categoryId, true, childIds)}
                                                />
                                            </div>
                                        </div>

                                        {/* Industries List (Accordion Content) */}
                                        <AnimatePresence>
                                            {isExpanded && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                                                    className="bg-[#121212]/50 border-l-2 border-white/5 ml-4 my-1 overflow-hidden"
                                                >
                                                    <div className="py-1 space-y-0.5">
                                                        {category.industries.map((industry, index) => {
                                                            const indStatus = getStatus(industry.id);
                                                            return (
                                                                <motion.div
                                                                    key={industry.id}
                                                                    initial={{ opacity: 0, x: -10 }}
                                                                    animate={{ opacity: 1, x: 0 }}
                                                                    transition={{ delay: index * 0.02, duration: 0.2 }}
                                                                    className="flex items-center justify-between pl-4 pr-3 py-2 hover:bg-white/10 transition-colors rounded-r-md group"
                                                                >
                                                                    <span className={cn(
                                                                        "text-sm transition-colors",
                                                                        indStatus === 'included' ? "text-white font-medium" : "text-gray-400 group-hover:text-gray-300"
                                                                    )}>
                                                                        {industry.name}
                                                                    </span>
                                                                    <ToggleGroup
                                                                        status={indStatus}
                                                                        onInclude={() => handleInclude(industry.id)}
                                                                        onExclude={() => handleExclude(industry.id)}
                                                                        onNeutral={() => handleNeutral(industry.id)}
                                                                    />
                                                                </motion.div>
                                                            );
                                                        })}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                );
                            })}
                            {filteredCategories.length === 0 && (
                                <div className="p-4 text-center text-sm text-muted-foreground">No industries found.</div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// Toggle Group Component for Include | Neutral | Exclude
const ToggleGroup = ({ status, onInclude, onExclude, onNeutral }: { status: string, onInclude: () => void, onExclude: () => void, onNeutral: () => void }) => {
    return (
        <div className="flex items-center bg-[#161616] rounded-md border border-white/10 p-0.5 h-6">
            <button
                type="button"
                onClick={status === 'included' ? onNeutral : onInclude}
                className={cn(
                    "h-full px-1.5 rounded-sm text-[10px] font-semibold transition-all flex items-center gap-1",
                    status === 'included'
                        ? "bg-[#00FF85] text-black shadow-sm"
                        : "text-muted-foreground hover:text-white"
                )}
                title="Include"
            >
                <Plus className="w-3 h-3" />
            </button>
            <div className="w-px h-2 bg-white/10 mx-0.5" />
            <button
                type="button"
                onClick={status === 'excluded' ? onNeutral : onExclude}
                className={cn(
                    "h-full px-1.5 rounded-sm text-[10px] font-semibold transition-all flex items-center gap-1",
                    status === 'excluded'
                        ? "bg-red-500 text-white shadow-sm"
                        : "text-muted-foreground hover:text-white"
                )}
                title="Exclude"
            >
                <Minus className="w-3 h-3" />
            </button>
        </div>
    )
}
