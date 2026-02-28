import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Video, FileText, Clock, User, Mic, MicOff, VideoOff, PhoneOff, MessageSquare, Star } from 'lucide-react';
import { mockInterviewRequests, InterviewRequest } from './mockData';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import StatusBadge from './StatusBadgeMarketplace';

const InterviewHub = () => {
  const [selectedInterview, setSelectedInterview] = useState<InterviewRequest | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const assignedInterviews = mockInterviewRequests.filter(r => r.expertId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{assignedInterviews.length}</p>
            <p className="text-xs text-muted-foreground">Assigned Interviews</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {assignedInterviews.filter(i => i.status === 'scheduled').length}
            </p>
            <p className="text-xs text-muted-foreground">Upcoming</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {assignedInterviews.filter(i => i.status === 'recorded' || i.status === 'verified_paid').length}
            </p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
      </div>

      {/* Interview List */}
      <div className="space-y-3">
        {assignedInterviews.map(interview => (
          <Card key={interview.id} className="hover:shadow-sm transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div>
                    <h4 className="font-medium text-foreground">{interview.candidateName}</h4>
                    <p className="text-sm text-muted-foreground">{interview.position} — {interview.company}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={interview.status} />
                  {interview.scheduledAt && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(interview.scheduledAt), 'MMM d, h:mm a')}
                    </span>
                  )}
                  {(interview.status === 'scheduled' || interview.status === 'in_progress') && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedInterview(interview);
                        setVideoOpen(true);
                      }}
                    >
                      <Video className="h-3.5 w-3.5 mr-1.5" />
                      {interview.status === 'in_progress' ? 'Rejoin' : 'Start Interview'}
                    </Button>
                  )}
                  {interview.status === 'recorded' && (
                    <Button size="sm" variant="outline" onClick={() => setSelectedInterview(interview)}>
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      View Scorecard
                    </Button>
                  )}
                </div>
              </div>

              {/* Tech Stack */}
              <div className="flex gap-1.5 mt-3">
                {interview.techStack.map(t => (
                  <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                ))}
                <span className="text-xs text-muted-foreground ml-2">
                  AI Score: <span className="font-medium text-foreground">{interview.aiScreeningScore}%</span>
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Video Interview Modal */}
      <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              Interview: {selectedInterview?.candidateName}
              <Badge variant="outline" className="ml-2 text-xs">Recording</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 flex gap-4 min-h-0">
            {/* Video Area */}
            <div className="flex-1 flex flex-col">
              <div className="flex-1 bg-muted/30 rounded-xl border border-border flex items-center justify-center relative">
                <div className="text-center space-y-3">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <Video className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground">Video feed preview</p>
                  <p className="text-xs text-muted-foreground">Camera and microphone ready</p>
                </div>
                {/* Self view */}
                <div className="absolute bottom-4 right-4 w-32 h-24 bg-muted rounded-lg border border-border flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">You</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3 mt-4">
                <Button
                  size="sm"
                  variant={micOn ? 'outline' : 'destructive'}
                  onClick={() => setMicOn(!micOn)}
                  className="rounded-full w-10 h-10 p-0"
                >
                  {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                </Button>
                <Button
                  size="sm"
                  variant={camOn ? 'outline' : 'destructive'}
                  onClick={() => setCamOn(!camOn)}
                  className="rounded-full w-10 h-10 p-0"
                >
                  {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setVideoOpen(false)}
                  className="rounded-full px-6"
                >
                  <PhoneOff className="h-4 w-4 mr-1.5" />
                  End
                </Button>
              </div>
            </div>

            {/* Notepad */}
            <div className="w-72 flex flex-col border border-border rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Interview Notes</span>
              </div>
              <Textarea
                className="flex-1 border-0 rounded-none resize-none focus-visible:ring-0 text-sm"
                placeholder="Take notes during the interview..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <div className="px-3 py-2 border-t border-border bg-muted/30">
                <Button size="sm" variant="outline" className="w-full text-xs">
                  <Star className="h-3 w-3 mr-1" /> Open Scorecard
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
