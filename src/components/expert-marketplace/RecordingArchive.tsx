import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Play, Calendar, Clock, User, ChevronLeft, MapPin } from 'lucide-react';
import { mockInterviewRequests, mockExperts, Expert } from './mockData';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

const RecordingArchive = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedExpert, setSelectedExpert] = useState<Expert | null>(null);

    const expertsWithRecordings = useMemo(() => {
        const expertIds = new Set(mockInterviewRequests
            .filter(i => i.status === 'recorded' || i.status === 'verified_paid')
            .map(i => i.expertId)
            .filter(Boolean)
        );
        return mockExperts.filter(e => expertIds.has(e.id));
    }, []);

    const filteredExperts = useMemo(() => {
        return expertsWithRecordings.filter(e =>
            e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            e.title.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery, expertsWithRecordings]);

    const expertRecordings = useMemo(() => {
        if (!selectedExpert) return [];
        return mockInterviewRequests.filter(i =>
            (i.status === 'recorded' || i.status === 'verified_paid') &&
            i.expertId === selectedExpert.id &&
            (i.candidateName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                i.position.toLowerCase().includes(searchQuery.toLowerCase()))
        );
    }, [selectedExpert, searchQuery]);

    const globalStats = [
        { label: 'Total Recordings', value: mockInterviewRequests.filter(i => i.status === 'recorded' || i.status === 'verified_paid').length, color: 'text-primary' },
        { label: 'Active Interviewers', value: expertsWithRecordings.length, color: 'text-blue-500' },
        { label: 'Avg Tech Score', value: '4.2/5', color: 'text-green-500' }
    ];

    return (
        <div className="space-y-6">
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
                        className="pl-9 bg-card/60 backdrop-blur-sm border-border/50"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {!selectedExpert ? (
                <>
                    {/* Global Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {globalStats.map((stat, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: i * 0.08 }}
                                className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-5"
                            >
                                <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">{stat.label}</p>
                                <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
                            </motion.div>
                        ))}
                    </div>

                    {/* Interviewer Profiles */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredExperts.map((expert, i) => {
                            const expertSessionCount = mockInterviewRequests.filter(int => (int.status === 'recorded' || int.status === 'verified_paid') && int.expertId === expert.id).length;

                            return (
                                <motion.div
                                    key={expert.id}
                                    initial={{ opacity: 0, y: 16 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4, delay: i * 0.08 }}
                                    className="group bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl hover:border-primary/40 hover:shadow-[0_8px_30px_rgba(5,148,103,0.08)] transition-all duration-200 hover:scale-[1.02] cursor-pointer overflow-hidden"
                                    onClick={() => { setSelectedExpert(expert); setSearchQuery(''); }}
                                >
                                    <div className="p-6">
                                        <div className="flex items-start gap-4 mb-4 border-b border-border/30 pb-4">
                                            <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-border/50 bg-muted shrink-0 group-hover:border-primary/40 transition-colors">
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
                                                <span className="text-xl font-bold font-mono text-primary">{expertSessionCount}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-6 py-3 bg-muted/10 border-t border-border/30 flex justify-between items-center group-hover:bg-primary/5 transition-colors">
                                        <span className="text-xs font-bold text-muted-foreground group-hover:text-primary transition-colors">View Library</span>
                                        <ChevronLeft className="h-4 w-4 rotate-180 text-muted-foreground group-hover:text-primary transition-colors" />
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <>
                    {/* Expert Context Header */}
                    <div className="flex items-center gap-4 bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-4">
                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-border/50 shadow-sm shrink-0">
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {expertRecordings.map((interview, i) => (
                            <motion.div
                                key={interview.id}
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: i * 0.08 }}
                                className="group bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl hover:border-primary/40 hover:shadow-[0_8px_30px_rgba(5,148,103,0.08)] transition-all duration-200 overflow-hidden flex flex-col"
                            >
                                {/* Gradient Thumbnail Placeholder */}
                                <div className="aspect-video bg-gradient-to-br from-primary/15 to-accent/15 relative flex items-center justify-center overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent z-10" />
                                    <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-background/70 text-[10px] font-mono font-bold text-foreground z-20 border border-border/50 backdrop-blur-sm">
                                        {interview.duration}m
                                    </div>
                                    <button className="absolute inset-0 flex items-center justify-center z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(5,148,103,0.4)] scale-90 group-hover:scale-100 transition-transform">
                                            <Play className="h-6 w-6 text-primary-foreground ml-1 fill-primary-foreground" />
                                        </div>
                                    </button>
                                </div>

                                <div className="p-5 flex-1 flex flex-col">
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

                                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/20 px-3 py-2 rounded-lg border border-border/50 mb-5">
                                        <Calendar className="h-4 w-4" />
                                        <span className="text-xs font-medium">{format(new Date(interview.scheduledAt || ''), 'MMMM d, yyyy  •  h:mm a')}</span>
                                    </div>

                                    <div className="flex gap-2 pt-4 border-t border-border/30 mt-auto">
                                        <Button variant="outline" size="sm" className="flex-1 h-9 text-xs font-bold border-primary/20 hover:bg-primary/5 text-primary">
                                            RECAP
                                        </Button>
                                        <Button size="sm" className="flex-1 h-9 text-xs font-bold shadow-[0_4px_10px_rgba(5,148,103,0.15)]">
                                            VIEW REPORT
                                        </Button>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                    {expertRecordings.length === 0 && (
                        <div className="py-20 text-center bg-card/30 rounded-2xl border-2 border-dashed border-border/50 flex flex-col items-center mt-6">
                            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                                <Search className="h-8 w-8 text-muted-foreground opacity-20" />
                            </div>
                            <p className="text-muted-foreground font-medium">No archived recordings found.</p>
                            <Button variant="link" onClick={() => setSearchQuery('')} className="mt-2 text-primary text-xs">Clear search</Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default RecordingArchive;
