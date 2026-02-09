import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { icpAPI } from "@/lib/api/icp";
import { useICPResults } from "@/hooks/useICPResults";
import { ProfileResult, ProfileResultCard } from "@/components/icp/ProfileResultCard";
import { SupabaseTest } from "@/components/SupabaseTest";
import { getMatchBadge } from "@/lib/matchBadges";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Search, Filter, Download, Sparkles,
    MoreHorizontal, LayoutGrid, List, SlidersHorizontal, Share2, Loader2, Calendar, Mail, Check, Copy,
    ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Linkedin } from "lucide-react";

const ICPResultsPage = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const navigate = useNavigate();
    const { toast } = useToast();

    // State
    const { profiles: results, loading: isLoading, count: totalCount } = useICPResults(sessionId);
    const [stats, setStats] = useState({ total: 0, avgScore: 0 });
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("score_desc");
    const [sessionName, setSessionName] = useState<string>("");

    // New State for Functionality
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
    const [showFilters, setShowFilters] = useState(false);
    const [minScore, setMinScore] = useState(0);
    const [locationFilter, setLocationFilter] = useState("");
    const [tierFilter, setTierFilter] = useState<string>("all");
    const [timeFilter, setTimeFilter] = useState<string>("latest"); // latest, oldest, today, week

    // Find Emails state
    const [findEmailCount, setFindEmailCount] = useState<string>("25");
    const [badgeFilter, setBadgeFilter] = useState<string>("all");
    const [showFindEmailsDropdown, setShowFindEmailsDropdown] = useState(false);

    // Fetch Session Metadata
    useEffect(() => {
        const fetchSessionMetadata = async () => {
            if (!sessionId) return;
            try {
                // Try fetching from sessions table
                const { data, error } = await supabase
                    .from('icp_lookalike_sessions')
                    .select('profile_name, created_at')
                    .eq('session_id', sessionId)
                    .single();

                if (data && data.profile_name) {
                    setSessionName(data.profile_name);
                } else {
                    // Fallback to "Session [ID]" if name not found
                    setSessionName(`Session ${sessionId.slice(0, 8)}`);
                }
            } catch (e) {
                console.error("Failed to load session name", e);
                setSessionName(`Session ${sessionId.slice(0, 8)}`);
            }
        };
        fetchSessionMetadata();
    }, [sessionId]);

    // Compute derived stats
    useEffect(() => {
        setStats({
            total: totalCount,
            avgScore: totalCount > 0
                ? Math.round(results.reduce((acc, p) => acc + (p.similarity_score || 0), 0) / totalCount)
                : 0
        });
    }, [results, totalCount]);


    // Handlers
    const handleShare = () => {
        navigator.clipboard.writeText(window.location.href);
        toast({
            title: "Link copied",
            description: "Session results link copied to clipboard.",
            variant: "default",
        });
    };

    const handleExportCSV = () => {
        if (filteredResults.length === 0) {
            toast({ title: "No data to export", variant: "destructive" });
            return;
        }

        const headers = ["Name", "Title", "Company", "Location", "Match Score", "Date Scraped"];
        const rows = filteredResults.map(p => [
            `"${p.name || ''}"`,
            `"${p.current_title || ''}"`,
            `"${p.current_company || ''}"`,
            `"${p.location || ''}"`,
            `${p.similarity_score || 0}`,
            `"${p.inserted_at ? new Date(p.inserted_at).toLocaleDateString() : ''}"`
        ]);

        const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `icp_results_${sessionId}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({ title: "Export started", description: `Downloading ${filteredResults.length} profiles.` });
    };

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // For bulk actions
    const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set()); // Track enriching status

    const handleSave = (id: string) => {
        setSavedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
                toast({ title: "Profile removed", description: "Removed from saved list." });
            } else {
                next.add(id);
                toast({ title: "Profile saved", description: "Added to your saved list." });
            }
            return next;
        });
    };

    const handleReveal = async (id: string) => {
        const profile = results.find(p => p.id === id);
        if (!profile || !profile.linkedin_url || !sessionId) return;

        setEnrichingIds(prev => new Set(prev).add(id));

        try {
            const response = await icpAPI.revealEmail(profile.id, profile.linkedin_url, sessionId);
            if (response.success === false && response.email === null) {
                toast({ title: "Email Not Found", description: "No verified email available.", variant: "destructive" });
            } else if (response.success) {
                toast({ title: "Enrichment Started", description: "Finding verified email...", className: "border-[#00FF85] text-[#00FF85]" });
            } else {
                toast({ title: "Enrichment Failed", description: response.error?.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Failed to start enrichment.", variant: "destructive" });
        } finally {
            // We rely on realtime updates for success, but clear loading flag if request is done
            // To prevent flickering, we might want to keep it true until update? 
            // But if update never comes (e.g. error), we need to clear.
            setEnrichingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const handleBulkEnrich = async (idsToEnrich: string[]) => {
        const targets = results.filter(p => idsToEnrich.includes(p.id) && !p.email && !enrichingIds.has(p.id));

        if (targets.length === 0) {
            toast({ title: "Nothing to enrich", description: "Selected profiles already have emails or are processing." });
            return;
        }

        toast({ title: "Bulk Enrichment Started", description: `Processing ${targets.length} profiles...` });

        // Mark all as enriching
        setEnrichingIds(prev => {
            const next = new Set(prev);
            targets.forEach(t => next.add(t.id));
            return next;
        });

        // Process in parallel
        await Promise.all(targets.map(async (profile) => {
            try {
                await icpAPI.revealEmail(profile.id, profile.linkedin_url!, sessionId!);
            } catch (e) {
                console.error(`Failed to enrich ${profile.id}`, e);
            } finally {
                setEnrichingIds(prev => {
                    const next = new Set(prev);
                    next.delete(profile.id);
                    return next;
                });
            }
        }));

        toast({ title: "Batch Completed", description: "Enrichment requests sent." });
    };

    // Find Emails by count + badge filter
    const handleFindEmails = () => {
        const count = parseInt(findEmailCount) || 25;

        // Filter by badge type first
        let candidates = filteredResults.filter(p => !p.email && !enrichingIds.has(p.id) && p.linkedin_url);
        if (badgeFilter !== 'all') {
            const ranges: Record<string, [number, number]> = {
                strong: [75, 100],
                good: [60, 74],
                potential: [50, 59],
                fair: [40, 49],
            };
            const range = ranges[badgeFilter];
            if (range) {
                candidates = candidates.filter(p => {
                    const s = p.similarity_score || 0;
                    return s >= range[0] && s <= range[1];
                });
            }
        }

        const toEnrich = candidates.slice(0, count).map(p => p.id);

        if (toEnrich.length === 0) {
            toast({ title: "No eligible profiles", description: "All matching profiles already have emails or are processing." });
            return;
        }

        handleBulkEnrich(toEnrich);
        setShowFindEmailsDropdown(false);
    };

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredResults.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredResults.map(p => p.id)));
        }
    };

    // Helper: details for time grouping
    const getDateLabel = (dateStr?: string) => {
        if (!dateStr) return "Unknown Date";
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return "Today";
        if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
        if (date > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) return "Past 7 Days";
        return "Older";
    };

    // Filtering & Sorting
    const filteredResults = (results || [])
        .filter(p => {
            if (!p) return false;
            const matchesSearch =
                (p.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
                (p.current_title || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
                (p.current_company || "").toLowerCase().includes(searchQuery.toLowerCase());

            const matchesScore = (p.similarity_score || 0) >= minScore;

            const matchesLocation = locationFilter
                ? (p.location || "").toLowerCase().includes(locationFilter.toLowerCase())
                : true;

            const matchesTier = tierFilter === 'all'
                ? true
                : p.tier_source === parseInt(tierFilter);

            // Time filtering
            let matchesTime = true;
            if (timeFilter === 'today') {
                const date = p.inserted_at ? new Date(p.inserted_at) : null;
                const today = new Date();
                matchesTime = date ? date.toDateString() === today.toDateString() : false;
            } else if (timeFilter === 'week') {
                const date = p.inserted_at ? new Date(p.inserted_at) : null;
                const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                matchesTime = date ? date > weekAgo : false;
            }

            return matchesSearch && matchesScore && matchesLocation && matchesTier && matchesTime;
        })
        .sort((a, b) => {
            // Priority Sort based on Time Filter Mode
            if (timeFilter === 'latest' || timeFilter === 'today' || timeFilter === 'week') {
                // Sort by Date Desc
                const dateA = a.inserted_at ? new Date(a.inserted_at).getTime() : 0;
                const dateB = b.inserted_at ? new Date(b.inserted_at).getTime() : 0;
                return dateB - dateA;
            }
            if (timeFilter === 'oldest') {
                // Sort by Date Asc
                const dateA = a.inserted_at ? new Date(a.inserted_at).getTime() : 0;
                const dateB = b.inserted_at ? new Date(b.inserted_at).getTime() : 0;
                return dateA - dateB;
            }

            // Fallback to manual sort
            if (sortBy === 'score_desc') return (b.similarity_score || 0) - (a.similarity_score || 0);
            if (sortBy === 'score_asc') return (a.similarity_score || 0) - (b.similarity_score || 0);
            if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
            return 0;
        });

    // Grouping Logic
    const groupedResults = filteredResults.reduce((groups, profile) => {
        const label = getDateLabel(profile.inserted_at);
        if (!groups[label]) groups[label] = [];
        groups[label].push(profile);
        return groups;
    }, {} as Record<string, typeof results>);

    // Order keys for rendering: Today, Yesterday, Past 7 Days, Older
    const groupOrder = ["Today", "Yesterday", "Past 7 Days", "Older", "Unknown Date"];

    // Determine if we should show groups (only if time sorted)
    const showGroups = ['latest', 'oldest', 'today', 'week'].includes(timeFilter);

    return (
        <div className="min-h-screen bg-[#050505] text-white flex flex-col">
            {/* Sticky Header */}
            <header className="sticky top-0 z-40 bg-[#050505]/95 backdrop-blur-md border-b border-white/5">
                <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => navigate('/icp-intelligence')} className="text-muted-foreground hover:text-white">
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div>
                            <h1 className="text-lg font-bold flex items-center gap-2">
                                Lookalike Results
                                <span className="text-muted-foreground mx-2">/</span>
                                <span className="text-[#00FF85]">
                                    {sessionName || "Loading..."}
                                </span>
                            </h1>
                            <p className="text-xs text-muted-foreground">Generated Strategy Session</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="hidden md:flex items-center gap-3 px-4 py-1.5 bg-[#161616] rounded-full border border-white/5 mr-4">
                            <div className="flex flex-col items-center px-4 border-r border-white/10">
                                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Total</span>
                                <span className="text-sm font-bold">{filteredResults.length} found</span>
                            </div>
                            <div className="flex flex-col items-center px-4">
                                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Avg Match</span>
                                <span className="text-sm font-bold text-[#00FF85]">{stats.avgScore}%</span>
                            </div>
                        </div>

                        <Button variant="outline" className="h-9 border-white/10 gap-2 hidden sm:flex" onClick={handleShare}>
                            <Share2 className="w-4 h-4" /> Share
                        </Button>
                        <Button className="h-9 bg-[#00FF85] text-black hover:bg-[#00FF85]/90 gap-2 shadow-[0_0_15px_rgba(0,255,133,0.3)]" onClick={handleExportCSV}>
                            <Download className="w-4 h-4" /> Export CSV
                        </Button>
                    </div>
                </div>

                {/* Secondary Toolbar (Filters) */}
                <div className="border-t border-white/5 bg-[#0A0A0A]">
                    <div className="max-w-[1600px] mx-auto px-6 py-3 flex flex-col gap-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-3 flex-1 min-w-[300px]">
                                <div className="relative flex-1 max-w-md">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search by name, title, or company..."
                                        className="pl-9 h-9 bg-[#161616] border-white/10 focus:border-[#00FF85]"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                                <Button
                                    variant={showFilters ? "secondary" : "outline"}
                                    size="sm"
                                    className={`h-9 gap-2 ${showFilters ? 'bg-white/10 text-white' : 'border-white/10 text-muted-foreground hover:text-white'}`}
                                    onClick={() => setShowFilters(!showFilters)}
                                >
                                    <Filter className="w-4 h-4" /> Filters
                                </Button>
                            </div>

                            <div className="flex items-center gap-2">
                                <Select value={sortBy} onValueChange={setSortBy}>
                                    <SelectTrigger className="h-9 w-[180px] bg-[#161616] border-white/10 text-sm">
                                        <SelectValue placeholder="Sort by" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#161616] border-white/10 text-white">
                                        <SelectItem value="score_desc">Match Score (High-Low)</SelectItem>
                                        <SelectItem value="score_asc">Match Score (Low-High)</SelectItem>
                                        <SelectItem value="name_asc">Name (A-Z)</SelectItem>
                                    </SelectContent>
                                </Select>

                                <div className="flex items-center p-1 bg-[#161616] rounded-lg border border-white/10 h-9">
                                    <Button
                                        variant="ghost" size="sm"
                                        className={cn("h-7 w-7 p-0 rounded-md", viewMode === 'grid' ? "bg-white/10 text-white" : "text-muted-foreground")}
                                        onClick={() => setViewMode('grid')}
                                    >
                                        <LayoutGrid className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost" size="sm"
                                        className={cn("h-7 w-7 p-0 rounded-md", viewMode === 'list' ? "bg-white/10 text-white" : "text-muted-foreground")}
                                        onClick={() => setViewMode('list')}
                                    >
                                        <List className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Expandable Filter Panel */}
                        {showFilters && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-[#161616] rounded-lg border border-white/5 animate-in slide-in-from-top-2">
                                <div className="space-y-2">
                                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Min Match Score: {minScore}%</label>
                                    <input
                                        type="range" min="0" max="100" step="5"
                                        value={minScore}
                                        onChange={(e) => setMinScore(Number(e.target.value))}
                                        className="w-full accent-[#00FF85]"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Location</label>
                                    <Input
                                        placeholder="Filter by city, country..."
                                        className="h-8 bg-[#0A0A0A] border-white/10 text-xs"
                                        value={locationFilter}
                                        onChange={(e) => setLocationFilter(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Tier</label>
                                    <div className="flex gap-2">
                                        {['all', '1', '2', '3'].map((tier) => (
                                            <button
                                                key={tier}
                                                onClick={() => setTierFilter(tier)}
                                                className={cn(
                                                    "px-3 py-1.5 rounded text-xs font-medium transition-colors border",
                                                    tierFilter === tier
                                                        ? "bg-[#00FF85] text-black border-[#00FF85]"
                                                        : "bg-[#0A0A0A] text-gray-400 border-white/10 hover:border-white/30"
                                                )}
                                            >
                                                {tier === 'all' ? 'All' : `Tier ${tier}`}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 p-6 overflow-y-auto">
                <div className="max-w-[1600px] mx-auto">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
                            <Loader2 className="w-10 h-10 animate-spin text-[#00FF85]" />
                            <p className="text-muted-foreground animate-pulse">Analyzing profiles and calculating match scores...</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl mt-8">
                                {[1, 2, 3].map(i => (
                                    <Skeleton key={i} className="h-[250px] w-full bg-[#161616] rounded-xl" />
                                ))}
                            </div>
                        </div>
                    ) : filteredResults.length > 0 ? (
                        viewMode === 'grid' ? (
                            <div className="space-y-5">
                                {/* Find Emails Action Bar */}
                                <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-card/60 border border-border/40 backdrop-blur-sm">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm text-muted-foreground font-medium">
                                            <span className="text-primary font-bold">{filteredResults.length}</span> results found
                                        </span>
                                        <span className="w-px h-5 bg-border/60" />
                                        {/* Badge Filter Chips */}
                                        <div className="flex items-center gap-1.5">
                                            {[
                                                { key: 'all', label: 'All', emoji: '', cls: 'border-border/60 text-muted-foreground hover:border-primary/40' },
                                                { key: 'strong', label: 'Strong', emoji: '💪', cls: 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10' },
                                                { key: 'good', label: 'Good', emoji: '👍', cls: 'border-blue-500/40 text-blue-300 hover:bg-blue-500/10' },
                                                { key: 'potential', label: 'Potential', emoji: '👌', cls: 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10' },
                                                { key: 'fair', label: 'Fair', emoji: '🤝', cls: 'border-gray-500/40 text-gray-300 hover:bg-gray-500/10' },
                                            ].map(chip => (
                                                <button
                                                    key={chip.key}
                                                    onClick={() => setBadgeFilter(chip.key)}
                                                    className={cn(
                                                        "px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                                                        badgeFilter === chip.key
                                                            ? chip.key === 'all'
                                                                ? "bg-primary/15 border-primary/60 text-primary"
                                                                : `bg-white/10 ${chip.cls} ring-1 ring-white/10`
                                                            : `bg-transparent ${chip.cls}`
                                                    )}
                                                >
                                                    {chip.emoji && <span className="mr-1">{chip.emoji}</span>}
                                                    {chip.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Find Emails Button with Dropdown */}
                                    <div className="relative">
                                        <div className="flex items-center">
                                            <Button
                                                onClick={handleFindEmails}
                                                className="h-9 rounded-r-none gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_15px_rgba(0,255,133,0.2)]"
                                            >
                                                <Sparkles className="w-4 h-4" />
                                                Find Emails
                                            </Button>
                                            <Button
                                                onClick={() => setShowFindEmailsDropdown(!showFindEmailsDropdown)}
                                                className="h-9 px-2 rounded-l-none border-l border-black/20 bg-primary text-primary-foreground hover:bg-primary/90"
                                            >
                                                <ChevronDown className="w-4 h-4" />
                                            </Button>
                                        </div>

                                        {showFindEmailsDropdown && (
                                            <div className="absolute right-0 top-full mt-2 w-56 p-3 rounded-xl bg-card border border-border/60 shadow-xl z-50 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                                                        Number of emails
                                                    </label>
                                                    <Select value={findEmailCount} onValueChange={setFindEmailCount}>
                                                        <SelectTrigger className="h-8 bg-background border-border/60 text-sm">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-card border-border/60">
                                                            {['10', '25', '50', '100', '200'].map(n => (
                                                                <SelectItem key={n} value={n}>
                                                                    {n} emails
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                                                        Filter by badge
                                                    </label>
                                                    <Select value={badgeFilter} onValueChange={setBadgeFilter}>
                                                        <SelectTrigger className="h-8 bg-background border-border/60 text-sm">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-card border-border/60">
                                                            <SelectItem value="all">All Badges</SelectItem>
                                                            <SelectItem value="strong">💪 Strong Match (75%+)</SelectItem>
                                                            <SelectItem value="good">👍 Good Match (60-74%)</SelectItem>
                                                            <SelectItem value="potential">👌 Potential (50-59%)</SelectItem>
                                                            <SelectItem value="fair">🤝 Fair Match (40-49%)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <Button
                                                    onClick={handleFindEmails}
                                                    className="w-full h-8 gap-2 bg-primary text-primary-foreground text-xs"
                                                >
                                                    <Mail className="w-3.5 h-3.5" />
                                                    Start Finding
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                                    {filteredResults.map(profile => (
                                        <ProfileResultCard
                                            key={profile.id}
                                            profile={profile}
                                            sessionId={sessionId}
                                            onSave={handleSave}
                                            onReveal={handleReveal}
                                            isEnriching={enrichingIds.has(profile.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-md border border-white/10 bg-[#161616]">
                                <Table>
                                    <TableHeader className="bg-black/20">
                                        <TableRow className="border-white/5 hover:bg-transparent">
                                            <TableHead className="w-[50px]">
                                                <Checkbox
                                                    checked={selectedIds.size === filteredResults.length && filteredResults.length > 0}
                                                    onCheckedChange={toggleSelectAll}
                                                    disabled={filteredResults.length === 0}
                                                    className="border-white/20 data-[state=checked]:bg-[#00FF85] data-[state=checked]:text-black"
                                                />
                                            </TableHead>
                                            <TableHead className="text-white font-bold cursor-pointer" onClick={() => setSortBy('name_asc')}>
                                                Name
                                            </TableHead>
                                            <TableHead className="text-white font-bold">Current Role</TableHead>
                                            <TableHead className="text-white font-bold">Location</TableHead>
                                            <TableHead className="text-white font-bold text-center">Match</TableHead>
                                            <TableHead className="text-white font-bold text-center">LinkedIn</TableHead>

                                            {/* Email Column - With Bulk Action in Header */}
                                            <TableHead className="text-white font-bold min-w-[200px]">
                                                {selectedIds.size > 0 ? (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 px-2 text-[#00FF85] hover:text-[#00FF85] hover:bg-[#00FF85]/10 -ml-2"
                                                        onClick={() => handleBulkEnrich(Array.from(selectedIds))}
                                                    >
                                                        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                                        Find Emails for {selectedIds.size}
                                                    </Button>
                                                ) : (
                                                    "Contact Email"
                                                )}
                                            </TableHead>

                                            <TableHead className="text-white font-bold text-right cursor-pointer" onClick={() => setTimeFilter('latest')}>
                                                Scraped At
                                            </TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredResults.map((profile) => (
                                            <TableRow
                                                key={profile.id}
                                                className={cn(
                                                    "border-white/5 hover:bg-white/5 transition-colors",
                                                    selectedIds.has(profile.id) && "bg-emerald-500/5 hover:bg-emerald-500/10"
                                                )}
                                            >
                                                <TableCell>
                                                    <Checkbox
                                                        checked={selectedIds.has(profile.id)}
                                                        onCheckedChange={() => toggleSelection(profile.id)}
                                                        className="border-white/20 data-[state=checked]:bg-[#00FF85] data-[state=checked]:text-black"
                                                    />
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-[#2A2A2A] overflow-hidden flex items-center justify-center shrink-0">
                                                            {profile.photo_url ? (
                                                                <img src={profile.photo_url} alt={profile.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <span className="text-xs text-gray-500">{profile.name.charAt(0)}</span>
                                                            )}
                                                        </div>
                                                        <span className="text-white truncate max-w-[150px]" title={profile.name}>{profile.name}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col max-w-[200px]">
                                                        <span className="text-sm text-gray-200 truncate" title={profile.current_title}>{profile.current_title}</span>
                                                        <span className="text-xs text-emerald-400 truncate" title={profile.current_company}>{profile.current_company}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-gray-400 max-w-[150px] truncate" title={profile.location}>{profile.location}</TableCell>
                                                <TableCell className="text-center">
                                                    {profile.similarity_score && (() => {
                                                        const score = profile.similarity_score;
                                                        let badge = { emoji: '🤔', color: 'text-gray-400 bg-gray-500/10 border-gray-500/50' };

                                                        if (score >= 75) badge = { emoji: '💪', color: 'text-[#00FF85] bg-[#00FF85]/10 border-[#00FF85]' };
                                                        else if (score >= 60) badge = { emoji: '👍', color: 'text-blue-400 bg-blue-500/10 border-blue-500/50' };
                                                        else if (score >= 50) badge = { emoji: '👌', color: 'text-purple-400 bg-purple-500/10 border-purple-500/50' };
                                                        else if (score >= 40) badge = { emoji: '🤝', color: 'text-orange-400 bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-orange-500/50' };

                                                        return (
                                                            <div className={cn(
                                                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold",
                                                                badge.color
                                                            )}>
                                                                <span>{badge.emoji}</span>
                                                                <span>{score}%</span>
                                                            </div>
                                                        );
                                                    })()}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {profile.linkedin_url && (
                                                        <a href={profile.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#0077b5]/10 text-[#0077b5] hover:bg-[#0077b5] hover:text-white transition-all">
                                                            <Linkedin className="w-4 h-4" />
                                                        </a>
                                                    )}
                                                </TableCell>

                                                {/* Email Cell */}
                                                <TableCell>
                                                    {profile.email ? (
                                                        <div className="flex items-center gap-2 group/email relative">
                                                            {/* Confidence Dot */}
                                                            {profile.email !== "Not Found" && (
                                                                <div className={cn(
                                                                    "w-2 h-2 rounded-full shrink-0",
                                                                    profile.email_confidence === 'low' ? "bg-amber-500" :
                                                                        profile.email_confidence === 'medium' ? "bg-emerald-400" :
                                                                            "bg-[#00FF85]"
                                                                )} title={`Confidence: ${profile.email_confidence}`} />
                                                            )}

                                                            <span className={cn(
                                                                "text-sm font-mono truncate max-w-[180px] select-all",
                                                                profile.email === "Not Found" ? "text-red-500" : "text-gray-200"
                                                            )}>
                                                                {profile.email}
                                                            </span>

                                                            {profile.email !== "Not Found" && (
                                                                <button
                                                                    onClick={() => {
                                                                        navigator.clipboard.writeText(profile.email!);
                                                                        toast({ title: "Copied", className: "h-8 border-[#00FF85] text-[#00FF85]" });
                                                                    }}
                                                                    className="opacity-0 group-hover/email:opacity-100 transition-opacity text-emerald-400 hover:text-emerald-300"
                                                                >
                                                                    <Copy className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}

                                                            {profile.email === "Not Found" && <span className="text-xs text-red-500/50 ml-1">(No Data)</span>}
                                                        </div>
                                                    ) : (
                                                        <Button
                                                            size="sm" variant="ghost"
                                                            className="h-7 w-full justify-start text-muted-foreground hover:text-[#00FF85] hover:bg-[#00FF85]/10"
                                                            onClick={() => handleReveal(profile.id)}
                                                            disabled={enrichingIds.has(profile.id)}
                                                        >
                                                            {enrichingIds.has(profile.id) ? (
                                                                <>
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-2 text-[#00FF85]" />
                                                                    <span className="text-[#00FF85]">Finding...</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Mail className="w-3.5 h-3.5 mr-2" />
                                                                    Reveal Email
                                                                </>
                                                            )}
                                                        </Button>
                                                    )}
                                                </TableCell>

                                                <TableCell className="text-right text-gray-500 text-xs font-mono">
                                                    {profile.inserted_at ? new Date(profile.inserted_at).toLocaleDateString() : '-'}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="sm" onClick={() => handleSave(profile.id)}>
                                                        <span className={cn("h-2 w-2 rounded-full", savedIds.has(profile.id) ? "bg-[#00FF85]" : "bg-white/20")} />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )
                    ) : (
                        <div className="flex flex-col items-center justify-center h-[50vh] text-center">
                            <div className="w-20 h-20 bg-[#161616] rounded-full flex items-center justify-center mb-4">
                                <Search className="w-10 h-10 text-muted-foreground/50" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">No results found</h3>
                            <p className="text-muted-foreground max-w-md">
                                Try adjusting your filters or search terms. If you just started a scrape, results might still be processing.
                            </p>
                            <Button variant="outline" className="mt-6 border-[#00FF85] text-[#00FF85] hover:bg-[#00FF85]/10" onClick={() => window.location.reload()}>
                                Refresh Results
                            </Button>
                        </div>
                    )}
                </div>

            </main >
            {/* Debug Component for Test Session */}
            {
                (sessionId === 'test-session-123' || sessionId?.includes('test')) && (
                    <div className="p-6">
                        <SupabaseTest />
                    </div>
                )
            }
        </div >
    );
};

export default ICPResultsPage;
