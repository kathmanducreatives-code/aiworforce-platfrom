import { useState } from 'react';
import { Users, Calendar, Video, ClipboardCheck, Search, Star, Clock, DollarSign, ShieldCheck, Play, CheckCircle2, Navigation2, FileText } from 'lucide-react';
import { mockExperts, mockInterviewRequests } from '@/components/expert-marketplace/mockData';
import { format } from 'date-fns';
import InterviewHub from '@/components/expert-marketplace/InterviewHub';
import CompanyReviewPanel from '@/components/expert-marketplace/CompanyReviewPanel';
import RecordingArchive from '@/components/expert-marketplace/RecordingArchive';

const ExpertMarketplace = () => {
  const [activeTab, setActiveTab] = useState<'directory' | 'requests' | 'hub' | 'recordings' | 'reviews'>('directory');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredExperts = mockExperts.filter(e =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.specializations.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 font-display">

      {/* Premium Header */}
      <div className="relative overflow-hidden border-b border-border bg-background">
        {/* Glow Effects */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-6 py-12 relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold tracking-widest uppercase mb-4">
                <Video className="w-3.5 h-3.5" /> Interview-as-a-Service
              </div>
              <h1 className="text-4xl font-bold text-foreground mb-2 tracking-tight">Expert Marketplace</h1>
              <p className="text-lg text-muted-foreground max-w-2xl">
                Deploy vetted technical leaders from top-tier tech companies to conduct profound, unbiased interviews on your behalf. Escrow-backed. 24h turnaround.
              </p>
            </div>

            {/* Quick Stats */}
            <div className="flex gap-4">
              <div className="bg-card/50 backdrop-blur border border-border rounded-xl p-4 min-w-[140px]">
                <p className="text-xs text-muted-foreground/70 uppercase tracking-wider mb-1">Vetted Experts</p>
                <p className="text-2xl font-mono font-bold text-foreground">142</p>
              </div>
              <div className="bg-card/50 backdrop-blur border border-border rounded-xl p-4 min-w-[140px]">
                <p className="text-xs text-muted-foreground/70 uppercase tracking-wider mb-1">Avg Turnaround</p>
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-mono font-bold text-blue-500">18</p>
                  <span className="text-sm font-medium text-muted-foreground">hours</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Tab Navigation */}
        <div className="flex items-center gap-8 border-b border-border mb-8">
          {[
            { id: 'directory', label: 'Expert Pool', icon: Users },
            { id: 'requests', label: 'Active Requests', icon: Calendar },
            { id: 'hub', label: 'Interview Hub', icon: Video },
            { id: 'recordings', label: 'Session Archive', icon: Play },
            { id: 'reviews', label: 'Company Reviews', icon: ClipboardCheck }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`pb-4 text-sm font-medium transition-all relative flex items-center gap-2 ${activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon className={`w-4 h-4 ${activeTab === tab.id ? 'text-primary' : ''}`} />
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full shadow-[0_0_10px_rgba(167,139,250,0.5)]" />
                )}
              </button>
            )
          })}
        </div>

        {/* DIRECTORY TAB */}
        {activeTab === 'directory' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Search/Filter Bar */}
            <div className="flex items-center gap-4 mb-8">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                <input
                  type="text"
                  placeholder="Search by name, title, or skill (e.g. React, Python)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>
              <button className="px-4 py-3 bg-card border border-border rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Available Now
              </button>
              <button className="px-4 py-3 bg-card border border-border rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Max $150/hr
              </button>
            </div>

            {/* Expert Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredExperts.map((expert, i) => (
                <div key={expert.id} className="bg-card border border-border rounded-2xl overflow-hidden group hover:border-primary/50 hover:shadow-[0_4px_30px_rgba(167,139,250,0.1)] transition-all flex flex-col relative">

                  {/* Top Color Bar Base on Spec */}
                  <div className={`h-1.5 w-full bg-gradient-to-r ${i % 3 === 0 ? 'from-primary to-blue-500' : i % 2 === 0 ? 'from-green-500 to-blue-500' : 'from-blue-500 to-blue-600'}`}></div>

                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex gap-3 items-center">
                        <div className="w-12 h-12 rounded-full overflow-hidden border border-border bg-muted relative">
                          <img src={`https://i.pravatar.cc/150?u=${expert.id}`} className="w-full h-full object-cover" alt="avatar" />
                          {expert.verified && (
                            <div className="absolute -bottom-1 -right-1 bg-card rounded-full p-0.5">
                              <ShieldCheck className="w-4 h-4 text-green-500" />
                            </div>
                          )}
                        </div>
                        <div>
                          <h3 className="font-bold text-foreground leading-tight">{expert.name}</h3>
                          <p className="text-xs text-muted-foreground">{expert.title}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-mono font-bold text-foreground">${expert.hourlyRate}</p>
                        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">/ hr</p>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground leading-relaxed mb-5 flex-1 line-clamp-2">
                      "{expert.bio}"
                    </p>

                    <div className="flex flex-wrap gap-1.5 mb-5">
                      {expert.specializations.slice(0, 3).map(spec => (
                        <span key={spec} className="px-2 py-1 rounded-md bg-background border border-border text-xs font-medium text-muted-foreground">
                          {spec}
                        </span>
                      ))}
                      {expert.specializations.length > 3 && (
                        <span className="px-2 py-1 rounded-md bg-background border border-border text-xs font-medium text-muted-foreground/70">
                          +{expert.specializations.length - 3}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-4 border-t border-b border-border mb-5">
                      <div className="text-center">
                        <div className="flex justify-center items-center gap-1 mb-1">
                          <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                          <span className="font-mono text-sm font-bold text-foreground">{expert.qualityScore}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Rating</p>
                      </div>
                      <div className="text-center border-l border-r border-border">
                        <div className="flex justify-center items-center gap-1 mb-1">
                          <Video className="w-3.5 h-3.5 text-blue-500" />
                          <span className="font-mono text-sm font-bold text-foreground">{expert.totalInterviews}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Completed</p>
                      </div>
                      <div className="text-center">
                        <div className="flex justify-center items-center gap-1 mb-1">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground/70" />
                          <span className="font-mono text-sm font-bold text-foreground">{expert.yearsExperience}y</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Experience</p>
                      </div>
                    </div>

                    <button className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm tracking-wide hover:bg-primary/90 shadow-[0_4px_14px_rgba(167,139,250,0.25)] transition-all">
                      Request Interview
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* REQUESTS TAB */}
        {activeTab === 'requests' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-4">

            <div className="flex justify-between items-end mb-6">
              <div>
                <h2 className="text-lg font-bold text-foreground tracking-wide">Active Escrow Requests</h2>
                <p className="text-sm text-muted-foreground">Manage and track your in-progress expert interviews.</p>
              </div>
              <button className="px-4 py-2 bg-card border border-border rounded-lg text-sm font-medium hover:text-foreground transition-colors flex items-center gap-2">
                <FileText className="w-4 h-4" /> Export CSV
              </button>
            </div>

            {mockInterviewRequests.map(req => (
              <div key={req.id} className="bg-card border border-border rounded-xl p-5 flex flex-col md:flex-row gap-6 md:items-center hover:border-border/80 transition-colors">

                {/* Status Indicator */}
                <div className="flex-shrink-0 flex items-center justify-center">
                  {req.status === 'scheduled' && <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-[0_0_15px_rgba(56,189,248,0.2)]"><Calendar className="w-5 h-5 text-blue-500" /></div>}
                  {req.status === 'pending_assignment' && <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center border border-yellow-500/20 shadow-[0_0_15px_rgba(250,204,21,0.2)]"><Clock className="w-5 h-5 text-yellow-500" /></div>}
                  {req.status === 'in_progress' && <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(167,139,250,0.2)]"><Navigation2 className="w-5 h-5 text-primary outline-none animate-pulse" /></div>}
                  {(req.status === 'recorded' || req.status === 'verified_paid') && <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20 shadow-[0_0_15px_rgba(0,212,170,0.2)]"><CheckCircle2 className="w-5 h-5 text-green-500" /></div>}
                </div>

                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">

                  {/* Candidate Info */}
                  <div>
                    <p className="text-xs text-muted-foreground/70 uppercase tracking-wider mb-1">Candidate</p>
                    <h4 className="font-bold text-foreground text-sm truncate">{req.candidateName}</h4>
                    <p className="text-xs text-muted-foreground truncate">{req.position}</p>
                  </div>

                  {/* Interviewer Info */}
                  <div>
                    <p className="text-xs text-muted-foreground/70 uppercase tracking-wider mb-1">Interviewer</p>
                    {req.expertName ? (
                      <div>
                        <span className="font-medium text-foreground text-sm truncate">{req.expertName}</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <ShieldCheck className="w-3 h-3 text-green-500" /><span className="text-[10px] text-green-500">Vetted</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm font-medium text-yellow-500 animate-pulse">Assigning expert...</span>
                    )}
                  </div>

                  {/* Timing */}
                  <div>
                    <p className="text-xs text-muted-foreground/70 uppercase tracking-wider mb-1">Schedule</p>
                    {req.scheduledAt ? (
                      <div>
                        <p className="text-sm text-foreground font-medium">{format(new Date(req.scheduledAt), 'MMM d, yyyy')}</p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{format(new Date(req.scheduledAt), 'h:mm a')}</p>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground/70 italic">TBD</span>
                    )}
                  </div>

                  {/* Escrow/Status Info */}
                  <div className="text-right flex flex-col justify-center">
                    <p className="font-mono font-bold text-foreground text-lg">${req.totalEscrow}</p>
                    {req.status === 'verified_paid' ? (
                      <span className="text-[10px] font-bold tracking-widest uppercase text-green-500">Paid Out ✓</span>
                    ) : (
                      <span className="text-[10px] font-bold tracking-widest uppercase text-blue-500 bg-blue-500/10 px-2 py-0.5 inline-block rounded self-end border border-blue-500/20 mt-1">In Escrow</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex items-center justify-end pl-4 border-l border-border ml-2">
                  {(req.status === 'recorded' || req.status === 'verified_paid') ? (
                    <button className="px-4 py-2 bg-green-500 text-background rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-green-500/90 transition-colors shadow-[0_4px_14px_rgba(0,212,170,0.3)]">
                      <Play className="w-4 h-4 fill-background" /> View Results
                    </button>
                  ) : (
                    <button className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                      Manage Tracker
                    </button>
                  )}
                </div>

              </div>
            ))}

          </div>
        )}

        {/* HUB TAB */}
        {activeTab === 'hub' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <InterviewHub />
          </div>
        )}

        {/* RECORDINGS TAB */}
        {activeTab === 'recordings' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <RecordingArchive />
          </div>
        )}

        {/* REVIEWS TAB */}
        {activeTab === 'reviews' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CompanyReviewPanel />
          </div>
        )}

      </div>
    </div>
  );
};

export default ExpertMarketplace;
