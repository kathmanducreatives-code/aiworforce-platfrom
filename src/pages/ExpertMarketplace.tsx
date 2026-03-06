import { useState } from 'react';
import { Users, Calendar, Video, ClipboardCheck, Search, Star, Clock, DollarSign, ShieldCheck, Play, CheckCircle2, Navigation2, FileText, Zap } from 'lucide-react';
import { mockExperts, mockInterviewRequests } from '@/components/expert-marketplace/mockData';
import { format } from 'date-fns';
import InterviewHub from '@/components/expert-marketplace/InterviewHub';
import CompanyReviewPanel from '@/components/expert-marketplace/CompanyReviewPanel';
import RecordingArchive from '@/components/expert-marketplace/RecordingArchive';
import { motion } from 'framer-motion';

const ExpertMarketplace = () => {
  const [activeTab, setActiveTab] = useState<'directory' | 'requests' | 'hub' | 'recordings' | 'reviews'>('directory');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredExperts = mockExperts.filter(e =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.specializations.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const tabs = [
    { id: 'directory', label: 'Expert Pool', icon: Users },
    { id: 'requests', label: 'Active Requests', icon: Calendar },
    { id: 'hub', label: 'Interview Hub', icon: Video },
    { id: 'recordings', label: 'Session Archive', icon: Play },
    { id: 'reviews', label: 'Company Reviews', icon: ClipboardCheck }
  ];

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 font-display">

      {/* Premium Header with Glassmorphism */}
      <div className="relative overflow-hidden border-b border-border/50">
        {/* Animated Mesh Gradient Orbs */}
        <div className="absolute -top-32 left-1/4 w-[500px] h-[500px] bg-primary/8 rounded-full blur-[120px] pointer-events-none animate-[pulse_10s_ease-in-out_infinite]" />
        <div className="absolute -top-20 right-1/3 w-[400px] h-[400px] bg-accent/8 rounded-full blur-[120px] pointer-events-none animate-[pulse_12s_ease-in-out_infinite_1s]" />

        <div className="max-w-7xl mx-auto px-4 py-8 md:px-6 md:py-12 relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold tracking-widest uppercase mb-4">
                <Video className="w-3.5 h-3.5" /> Interview-as-a-Service
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2 tracking-tight">Expert Marketplace</h1>
              <p className="text-base md:text-lg text-muted-foreground max-w-2xl">
                Deploy vetted technical leaders from top-tier tech companies to conduct profound, unbiased interviews on your behalf.
              </p>
            </div>

            {/* Quick Stats - horizontally scrollable on mobile */}
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 md:mx-0 md:px-0">
              {[
                { label: 'Vetted Experts', value: '142', color: 'text-foreground' },
                { label: 'Avg Turnaround', value: '18h', color: 'text-primary' },
                { label: 'Satisfaction', value: '98%', color: 'text-green-500' },
              ].map((stat) => (
                <div key={stat.label} className="bg-card/60 backdrop-blur-xl border border-border/50 rounded-xl p-4 min-w-[130px] flex-shrink-0">
                  <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1">{stat.label}</p>
                  <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">

        {/* Pill-Style Tab Navigation */}
        <div className="flex items-center gap-2 mb-8 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 md:mx-0 md:px-0">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0
                  ${isActive
                    ? 'bg-primary/10 border border-primary/25 text-primary shadow-[0_0_12px_rgba(5,148,103,0.1)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                  }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* DIRECTORY TAB */}
        {activeTab === 'directory' && (
          <div>
            {/* Search/Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-8">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                <input
                  type="text"
                  placeholder="Search by name, title, or skill..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl pl-10 pr-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-muted-foreground/50"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="px-4 py-3 bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all">
                  Available Now
                </button>
                <button className="px-4 py-3 bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all">
                  Max $150/hr
                </button>
              </div>
            </div>

            {/* Expert Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredExperts.map((expert, i) => (
                <motion.div
                  key={expert.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.08 }}
                  className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl overflow-hidden group hover:border-primary/40 hover:shadow-[0_8px_30px_rgba(5,148,103,0.08)] transition-all duration-200 hover:scale-[1.02] flex flex-col relative"
                >
                  {/* Left Accent Bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl ${expert.verified ? 'bg-green-500/60' : 'bg-amber-500/60'}`} />

                  <div className="p-6 pl-7 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex gap-3 items-center">
                        <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-border/50 bg-muted relative group-hover:border-primary/40 transition-colors">
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
                        <span key={spec} className="px-2 py-1 rounded-md bg-muted/50 border border-border/50 text-xs font-medium text-muted-foreground">
                          {spec}
                        </span>
                      ))}
                      {expert.specializations.length > 3 && (
                        <span className="px-2 py-1 rounded-md bg-muted/50 border border-border/50 text-xs font-medium text-muted-foreground/70">
                          +{expert.specializations.length - 3}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-4 border-t border-b border-border/50 mb-5">
                      <div className="text-center">
                        <div className="flex justify-center items-center gap-1 mb-1">
                          <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                          <span className="font-mono text-sm font-bold text-foreground">{expert.qualityScore}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Rating</p>
                      </div>
                      <div className="text-center border-l border-r border-border/50">
                        <div className="flex justify-center items-center gap-1 mb-1">
                          <Video className="w-3.5 h-3.5 text-primary" />
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

                    <button className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm tracking-wide hover:bg-primary/90 shadow-[0_4px_14px_rgba(5,148,103,0.2)] transition-all">
                      Request Interview
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* REQUESTS TAB */}
        {activeTab === 'requests' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 gap-4">
              <div>
                <h2 className="text-lg font-bold text-foreground tracking-wide">Active Escrow Requests</h2>
                <p className="text-sm text-muted-foreground">Manage and track your in-progress expert interviews.</p>
              </div>
              <button className="px-4 py-2 bg-card/60 backdrop-blur-sm border border-border/50 rounded-lg text-sm font-medium hover:text-foreground transition-colors flex items-center gap-2">
                <FileText className="w-4 h-4" /> Export CSV
              </button>
            </div>

            {mockInterviewRequests.map((req, i) => {
              const statusBorderColor = {
                scheduled: 'border-l-blue-500/60',
                pending_assignment: 'border-l-amber-500/60',
                in_progress: 'border-l-primary/60',
                recorded: 'border-l-green-500/60',
                verified_paid: 'border-l-green-500/60',
              }[req.status] || 'border-l-border';

              return (
                <motion.div
                  key={req.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.06 }}
                  className={`bg-card/60 backdrop-blur-sm border border-border/50 border-l-4 ${statusBorderColor} rounded-xl p-5 flex flex-col md:flex-row gap-6 md:items-center hover:shadow-[0_4px_20px_rgba(5,148,103,0.06)] transition-all`}
                >
                  {/* Status Indicator */}
                  <div className="flex-shrink-0 flex items-center justify-center">
                    {req.status === 'scheduled' && <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20"><Calendar className="w-5 h-5 text-blue-500" /></div>}
                    {req.status === 'pending_assignment' && <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20"><Clock className="w-5 h-5 text-amber-500" /></div>}
                    {req.status === 'in_progress' && <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20"><Navigation2 className="w-5 h-5 text-primary animate-pulse" /></div>}
                    {(req.status === 'recorded' || req.status === 'verified_paid') && <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20"><CheckCircle2 className="w-5 h-5 text-green-500" /></div>}
                  </div>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
                    <div>
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1">Candidate</p>
                      <h4 className="font-bold text-foreground text-sm truncate">{req.candidateName}</h4>
                      <p className="text-xs text-muted-foreground truncate">{req.position}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1">Interviewer</p>
                      {req.expertName ? (
                        <div>
                          <span className="font-medium text-foreground text-sm truncate">{req.expertName}</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <ShieldCheck className="w-3 h-3 text-green-500" /><span className="text-[10px] text-green-500">Vetted</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm font-medium text-amber-500 animate-pulse">Assigning expert...</span>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1">Schedule</p>
                      {req.scheduledAt ? (
                        <div>
                          <p className="text-sm text-foreground font-medium">{format(new Date(req.scheduledAt), 'MMM d, yyyy')}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{format(new Date(req.scheduledAt), 'h:mm a')}</p>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground/70 italic">TBD</span>
                      )}
                    </div>
                    <div className="text-right flex flex-col justify-center">
                      <p className="font-mono font-bold text-foreground text-lg">${req.totalEscrow}</p>
                      {req.status === 'verified_paid' ? (
                        <span className="text-[10px] font-bold tracking-widest uppercase text-green-500">Paid Out ✓</span>
                      ) : (
                        <span className="text-[10px] font-bold tracking-widest uppercase text-primary bg-primary/10 px-2 py-0.5 inline-block rounded self-end border border-primary/20 mt-1">In Escrow</span>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0 flex items-center justify-end pl-4 border-l border-border/50 ml-2">
                    {(req.status === 'recorded' || req.status === 'verified_paid') ? (
                      <button className="px-4 py-2 bg-green-500 text-background rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-green-500/90 transition-colors shadow-[0_4px_14px_rgba(0,200,150,0.25)]">
                        <Play className="w-4 h-4 fill-background" /> View Results
                      </button>
                    ) : (
                      <button className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                        Manage Tracker
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* HUB TAB */}
        {activeTab === 'hub' && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <InterviewHub />
          </motion.div>
        )}

        {/* RECORDINGS TAB */}
        {activeTab === 'recordings' && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <RecordingArchive />
          </motion.div>
        )}

        {/* REVIEWS TAB */}
        {activeTab === 'reviews' && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <CompanyReviewPanel />
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default ExpertMarketplace;
