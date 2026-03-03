import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Play, FileText, Calendar, Clock, User, Download, ChevronLeft, MapPin } from 'lucide-react';
import { mockInterviewRequests, mockExperts, Expert } from './mockData';
import { format } from 'date-fns';

const zoomThumbnail = "/Users/prasidha/.gemini/antigravity/brain/56fe69e8-9ae9-4fe4-9ad4-caac2f995a40/zoom_meeting_thumbnail_1772466883160.png";

const RecordingArchive = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedExpert, setSelectedExpert] = useState<Expert | null>(null);

    // Get all experts who have completed recordings
    const expertsWithRecordings = useMemo(() => {
        const expertIds = new Set(mockInterviewRequests
            .filter(i => i.status === 'recorded' || i.status === 'verified_paid')
            .map(i => i.expertId)
            .filter(Boolean)
        );
        return mockExperts.filter(e => expertIds.has(e.id));
    }, []);

    // Filter experts based on search query (when in top-level view)
    const filteredExperts = useMemo(() => {
        return expertsWithRecordings.filter(e =>
            e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            e.title.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery, expertsWithRecordings]);

    // Get recordings for the selected expert (when in drill-down view)
    const expertRecordings = useMemo(() => {
        if (!selectedExpert) return [];
        return mockInterviewRequests.filter(i =>
            (i.status === 'recorded' || i.status === 'verified_paid') &&
            i.expertId === selectedExpert.id &&
            (i.candidateName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                i.position.toLowerCase().includes(searchQuery.toLowerCase()))
        );
    }, [selectedExpert, searchQuery]);

    // Global Stats
    const globalStats = [
        { label: 'Total Recordings', value: mockInterviewRequests.filter(i => i.status === 'recorded' || i.status === 'verified_paid').length, color: 'text-primary' },
        { label: 'Active Interviewers', value: expertsWithRecordings.length, color: 'text-blue-500' },
        { label: 'Avg Tech Score', value: '4.2/5', color: 'text-green-500' }
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header & Search */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    {selectedExpert ? (
                        <div className="flex flex-col gap-1">
                            <Button
                                onClick={() => { setSelectedExpert(null); setSearchQuery(''); }}
                                variant="ghost"
                                className="w-fit p-0 h-auto hover:bg-transparent text-muted-foreground hover:text-foreground -ml-1 transition-colors group"
                            >
                                <ChevronLeft className="h-4 w-4 mr-1 group-hover:-translate-x-1 transition-transform" />
                                Back to Interviewers
                            </Button>
                            <h2 className="text-xl font-bold text-foreground flex items-center gap-2 mt-2">
                                Recordings by {selectedExpert.name}
                            </h2>
                        </div>
                    ) : (
                        <div>
                            <h2 className="text-xl font-bold text-foreground">Session Archive</h2>
                            <p className="text-sm text-muted-foreground">Select an interviewer to view their specific session recordings.</p>
                        </div>
                    )}
                </div>

                <div className="relative w-full md:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={selectedExpert ? "Search candidates..." : "Search interviewers..."}
                        className="pl-9 bg-card border-border"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {/* View Switching */}
            {!selectedExpert ? (
                // --- TOP LEVEL: EXPERT GRID ---
                <>
                    {/* Global Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {globalStats.map((stat, i) => (
                            <Card key={i} className="bg-card/50 backdrop-blur-sm border-border">
                                <CardContent className="p-4">
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">{stat.label}</p>
                                    <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {/* Interviewer Profiles */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredExperts.map((expert) => {
                            const expertSessionCount = mockInterviewRequests.filter(i => (i.status === 'recorded' || i.status === 'verified_paid') && i.expertId === expert.id).length;

                            return (
                                <Card
                                    key={expert.id}
                                    className="group bg-card border-border hover:border-primary/50 transition-all cursor-pointer shadow-sm hover:shadow-md"
                                    onClick={() => { setSelectedExpert(expert); setSearchQuery(''); }}
                                >
                                    <CardContent className="p-6">
                                        <div className="flex items-start gap-4 mb-4 border-b border-border/50 pb-4">
                                            <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-primary/20 bg-muted shrink-0 group-hover:border-primary/50 transition-colors">
                                                <img src={expert.avatar} alt={expert.name} className="w-full h-full object-cover" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-lg text-foreground leading-tight group-hover:text-primary transition-colors">{expert.name}</h3>
                                                <p className="text-sm text-muted-foreground mb-1">{expert.title}</p>
                                                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                                    <MapPin className="h-3 w-3" />
                                                    {expert.university.split(' ')[0]}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-end">
                                            <div>
                                                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Expert Rating</p>
                                                <span className="text-xl font-bold font-mono text-foreground">{expert.qualityScore}/5.0</span>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Archived Sessions</p>
                                                <span className="text-xl font-bold font-mono text-blue-500">{expertSessionCount}</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                    <div className="px-6 py-3 bg-muted/20 border-t border-border mt-auto flex justify-between items-center group-hover:bg-primary/5 transition-colors">
                                        <span className="text-xs font-bold text-muted-foreground group-hover:text-primary transition-colors">View Library</span>
                                        <ChevronLeft className="h-4 w-4 rotate-180 text-muted-foreground group-hover:text-primary transition-colors" />
                                    </div>
                                </Card>
                            )
                        })}
                    </div>
                </>
            ) : (
                // --- DRILL DOWN: EXPERT RECORDINGS ---
                <>
                    {/* Expert Context Header */}
                    <div className="flex items-center gap-4 bg-muted/20 border border-border rounded-xl p-4">
                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-background shadow-sm shrink-0">
                            <img src={selectedExpert.avatar} alt={selectedExpert.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-0.5">Primary Interviewer</p>
                            <p className="text-sm font-medium text-foreground">{selectedExpert.name}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-0.5">Found Sessions</p>
                            <p className="text-sm font-mono font-bold text-primary">{expertRecordings.length}</p>
                        </div>
                    </div>

                    {/* Recording Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-right-4 duration-300">
                        {expertRecordings.map((interview) => (
                            <Card key={interview.id} className="group border-border bg-card hover:border-primary/40 transition-all overflow-hidden shadow-sm hover:shadow-md flex flex-col">
                                {/* Zoom Thumbnail (No HD Badge) */}
                                <div className="aspect-video bg-muted relative flex items-center justify-center overflow-hidden">
                                    <img
                                        src={zoomThumbnail}
                                        alt="Zoom Meeting"
                                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                    <div className="absolute inset-0 bg-black/30 group-hover:bg-black/50 transition-colors z-10" />
                                    <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-mono font-bold text-white z-20 border border-white/10 backdrop-blur-sm shadow-xl">
                                        {interview.duration}m
                                    </div>
                                    <button className="absolute inset-0 flex items-center justify-center z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(167,139,250,0.5)] scale-90 group-hover:scale-100 transition-transform">
                                            <Play className="h-6 w-6 text-white ml-1 fill-white" />
                                        </div>
                                    </button>
                                </div>

                                <CardContent className="p-5 flex-1 flex flex-col">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-foreground leading-tight">{interview.candidateName}</h3>
                                            <p className="text-xs text-muted-foreground mt-1">{interview.position}</p>
                                        </div>
                                        <div className="text-right">
                                            <div className="flex items-center gap-1.5 justify-end">
                                                <span className="text-sm font-bold text-primary">{interview.scorecard?.overallRating}</span>
                                                <div className="flex">
                                                    {[1, 2, 3, 4, 5].map(star => (
                                                        <span key={star} className={`w-1.5 h-1.5 rounded-full mx-0.5 ${star <= (interview.scorecard?.overallRating || 0) ? 'bg-primary' : 'bg-muted'}`} />
                                                    ))}
                                                </div>
                                            </div>
                                            <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter mt-1">Given Score</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/30 px-3 py-2 rounded-lg border border-border mb-5">
                                        <Calendar className="h-4 w-4" />
                                        <span className="text-xs font-medium">{format(new Date(interview.scheduledAt || ''), 'MMMM d, yyyy  •  h:mm a')}</span>
                                    </div>

                                    <div className="flex gap-2 pt-4 border-t border-border/50 mt-auto">
                                        <Button variant="outline" size="sm" className="flex-1 h-9 text-xs font-bold border-primary/20 hover:bg-primary/5 text-primary group/btn shadow-sm">
                                            RECAP
                                        </Button>
                                        <Button size="sm" className="flex-1 h-9 text-xs font-bold shadow-[0_4px_10px_rgba(167,139,250,0.2)]">
                                            VIEW REPORT
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                    {expertRecordings.length === 0 && (
                        <div className="py-20 text-center bg-card/30 rounded-2xl border-2 border-dashed border-border flex flex-col items-center mt-6">
                            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                                <Search className="h-8 w-8 text-muted-foreground opacity-20" />
                            </div>
                            <p className="text-muted-foreground font-medium">No archived recordings found for this candidate.</p>
                            <Button variant="link" onClick={() => setSearchQuery('')} className="mt-2 text-primary text-xs">Clear search</Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default RecordingArchive;
