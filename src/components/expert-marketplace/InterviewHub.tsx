import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Video, Clock, User, MessageSquare, Star, Navigation2, Play, Users, CheckCircle2 } from 'lucide-react';
import { mockInterviewRequests, InterviewRequest } from './mockData';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import StatusBadge from './StatusBadgeMarketplace';
import { motion } from 'framer-motion';

const InterviewHub = () => {
  const [selectedInterview, setSelectedInterview] = useState<InterviewRequest | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [notes, setNotes] = useState('');

  const assignedInterviews = mockInterviewRequests.filter(r => r.expertId);
  const liveInterviews = assignedInterviews.filter(i => i.status === 'in_progress');
  const upcomingInterviews = assignedInterviews.filter(i => i.status === 'scheduled');

  const stats = [
    { label: 'Assigned', value: assignedInterviews.length, icon: Users, color: 'text-primary bg-primary/10' },
    { label: 'Upcoming', value: assignedInterviews.filter(i => i.status === 'scheduled').length, icon: Clock, color: 'text-blue-500 bg-blue-500/10' },
    { label: 'Completed', value: assignedInterviews.filter(i => i.status === 'recorded' || i.status === 'verified_paid').length, icon: CheckCircle2, color: 'text-green-500 bg-green-500/10' },
  ];

  return (
    <div className="space-y-6">
      {/* Stat Cards with Glassmorphism */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-bold mb-1">{stat.label}</p>
                  <p className="text-3xl font-mono font-bold text-foreground">{stat.value}</p>
                </div>
                <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', stat.color)}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Live Now Section */}
      {liveInterviews.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Live Shadowing Available</h3>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {liveInterviews.map(interview => (
              <div key={interview.id} className="bg-card/60 backdrop-blur-sm border border-primary/20 rounded-xl shadow-[0_0_20px_rgba(5,148,103,0.12)] p-5">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center relative">
                      <User className="h-6 w-6 text-muted-foreground" />
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-background animate-pulse" />
                    </div>
                    <div>
                      <h4 className="font-bold text-foreground">{interview.candidateName}</h4>
                      <p className="text-sm text-muted-foreground">{interview.position} — <span className="text-primary font-medium">{interview.expertName}</span></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex -space-x-2 mr-4">
                      {[1, 2].map(i => (
                        <div key={i} title="Admin Shadowing" className="w-7 h-7 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                          A{i}
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-background hover:bg-muted"
                      onClick={() => {
                        setSelectedInterview(interview);
                        setVideoOpen(true);
                      }}
                    >
                      <Navigation2 className="h-3.5 w-3.5 mr-1.5 text-primary fill-primary/20" />
                      Shadow Live
                    </Button>
                    <Button size="sm" className="bg-primary hover:bg-primary/90">
                      <Video className="h-3.5 w-3.5 mr-1.5" />
                      Join Zoom
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Sessions View */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Upcoming Sessions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {upcomingInterviews.map((interview, i) => (
            <motion.div
              key={interview.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-5 hover:border-primary/30 hover:shadow-[0_4px_20px_rgba(5,148,103,0.06)] transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <StatusBadge status={interview.status} />
                <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {interview.scheduledAt && format(new Date(interview.scheduledAt), 'MMM d, h:mm a')}
                </span>
              </div>
              <h4 className="font-medium text-foreground">{interview.candidateName}</h4>
              <p className="text-xs text-muted-foreground mb-3">{interview.position}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                    {interview.expertName?.split(' ').map(n => n[0]).join('')}
                  </div>
                  {interview.expertName}
                </div>
                <Button variant="ghost" size="sm" className="h-8 text-xs">Edit Details</Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Video Interview Modal */}
      <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader className="border-b border-border pb-4">
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                  <Navigation2 className="h-5 w-5 text-red-500 fill-red-500/20 animate-pulse" />
                </div>
                <div>
                  <p className="text-xs font-bold text-red-500 uppercase tracking-widest">Shadowing Live Room</p>
                  <h3 className="text-lg font-bold text-foreground">{selectedInterview?.candidateName}</h3>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Duration</p>
                  <p className="text-sm font-mono font-bold text-foreground">32:14</p>
                </div>
                <Badge variant="outline" className="text-xs border-green-500/30 text-green-500 bg-green-500/5">Secure Connection</Badge>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 flex gap-4 min-h-0">
            <div className="flex-1 flex flex-col">
              <div className="flex-1 bg-black rounded-xl border border-border/20 flex items-center justify-center relative shadow-2xl overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40 pointer-events-none z-10" />
                <div className="relative z-20 text-center space-y-4">
                  <div className="w-24 h-24 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center mx-auto backdrop-blur-sm">
                    <User className="h-10 w-10 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white tracking-wide">Candidate: {selectedInterview?.candidateName}</p>
                    <p className="text-xs text-white/60">Using Integrated WebRTC</p>
                  </div>
                </div>
                <div className="absolute top-4 right-4 w-48 aspect-video bg-zinc-900 rounded-lg border border-border/20 shadow-xl overflow-hidden z-30">
                  <div className="absolute bottom-2 left-2 text-[8px] font-bold text-white bg-black/50 px-1 rounded uppercase tracking-widest">
                    Expert: {selectedInterview?.expertName}
                  </div>
                  <div className="w-full h-full flex items-center justify-center border-t-2 border-primary/40">
                    <User className="h-8 w-8 text-primary/40" />
                  </div>
                </div>
                <div className="absolute top-4 left-4 flex items-center gap-2 z-30">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/60 border border-border/20 backdrop-blur-md">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-mono font-bold text-white uppercase tracking-tighter">HD LIVE</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 px-2 flex-wrap gap-4">
                <div className="flex items-center gap-6">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Your Mic</span>
                    <span className="text-xs font-bold text-red-500">MUTED (Shadow Mode)</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Your Feed</span>
                    <span className="text-xs font-bold text-muted-foreground">OFF (Invisible)</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" className="rounded-full h-10 w-10 p-0 border-border">
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" size="sm" className="rounded-full px-6 font-bold h-10">
                    Join Discussion
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setVideoOpen(false)} className="rounded-full px-8 h-10 font-bold">
                    Stop Shadowing
                  </Button>
                </div>
              </div>
            </div>

            <div className="w-72 flex flex-col border border-border/50 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 border-b border-border/50 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Interview Notes</span>
              </div>
              <Textarea
                className="flex-1 border-0 rounded-none resize-none focus-visible:ring-0 text-sm"
                placeholder="Take notes during the interview..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <div className="px-3 py-2 border-t border-border/50 bg-muted/30">
                <Button size="sm" variant="outline" className="w-full text-xs">
                  <Star className="h-3 w-3 mr-1 text-yellow-500" /> Open Scorecard
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InterviewHub;
