import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Play, Download, Star, ThumbsUp, ThumbsDown, CheckCircle2, AlertCircle, DollarSign } from 'lucide-react';
import { mockInterviewRequests } from './mockData';
import StatusBadge from './StatusBadgeMarketplace';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const ratingLabels: Record<string, string> = {
  strong_hire: 'Strong Hire',
  hire: 'Hire',
  no_hire: 'No Hire',
  strong_no_hire: 'Strong No Hire',
};

const ratingColors: Record<string, string> = {
  strong_hire: 'text-green-600 bg-green-500/10 border-green-500/30',
  hire: 'text-blue-600 bg-blue-500/10 border-blue-500/30',
  no_hire: 'text-yellow-600 bg-yellow-500/10 border-yellow-500/30',
  strong_no_hire: 'text-red-600 bg-red-500/10 border-red-500/30',
};

const CompanyReviewPanel = () => {
  const completed = mockInterviewRequests.filter(r => r.scorecard);

  return (
    <div className="space-y-6">
      {completed.length === 0 && (
        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-10 text-center">
          <p className="text-muted-foreground">No completed interviews to review yet.</p>
        </div>
      )}

      {completed.map((interview, idx) => (
        <motion.div
          key={interview.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: idx * 0.1 }}
          className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-6 pb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-bold text-foreground">{interview.candidateName}</h3>
                <p className="text-sm text-muted-foreground">{interview.position} — {interview.company}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={interview.status} />
                {interview.scheduledAt && (
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(interview.scheduledAt), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="px-6 pb-6 space-y-5">
            {/* Recording Placeholder with gradient */}
            <div className="bg-gradient-to-br from-primary/5 to-accent/5 border border-border/50 rounded-xl p-6 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Play className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Interview Recording</p>
                  <p className="text-xs text-muted-foreground">{interview.duration} minutes • Conducted by {interview.expertName}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-border/50">
                  <Download className="h-3.5 w-3.5 mr-1" /> Download
                </Button>
                <Button size="sm">
                  <Play className="h-3.5 w-3.5 mr-1" /> Watch
                </Button>
              </div>
            </div>

            {/* Scorecard */}
            {interview.scorecard && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="md:col-span-2 space-y-4">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Star className="h-4 w-4 text-yellow-500" /> Expert Scorecard
                  </h4>
                  {[
                    { label: 'Technical Skills', score: interview.scorecard.technicalSkills },
                    { label: 'Problem Solving', score: interview.scorecard.problemSolving },
                    { label: 'Communication', score: interview.scorecard.communication },
                    { label: 'Culture Fit', score: interview.scorecard.cultureFit },
                  ].map(item => (
                    <div key={item.label} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-medium">{item.score}/5</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${item.score * 20}%` }}
                        />
                      </div>
                    </div>
                  ))}

                  <Separator className="bg-border/50" />

                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">Overall Rating</span>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-foreground">{interview.scorecard.overallRating}</span>
                      <span className="text-sm text-muted-foreground">/5</span>
                    </div>
                  </div>

                  <Badge className={cn('text-sm px-4 py-1', ratingColors[interview.scorecard.recommendation])} variant="outline">
                    {ratingLabels[interview.scorecard.recommendation]}
                  </Badge>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-green-600 flex items-center gap-1">
                        <ThumbsUp className="h-3 w-3" /> Strengths
                      </h5>
                      {interview.scorecard.strengths.map((s, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                          {s}
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-yellow-600 flex items-center gap-1">
                        <ThumbsDown className="h-3 w-3" /> Concerns
                      </h5>
                      {interview.scorecard.concerns.map((c, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <AlertCircle className="h-3 w-3 text-yellow-500 mt-0.5 flex-shrink-0" />
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-muted/20 border border-border/50 rounded-lg p-3 mt-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Expert Notes</p>
                    <p className="text-sm">{interview.scorecard.notes}</p>
                  </div>
                </div>

                {/* Payment Sidebar */}
                <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-xl p-4 space-y-3 h-fit">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4" /> Payment Summary
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Interview Fee</span>
                      <span>${interview.interviewFee}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Platform Fee</span>
                      <span>${interview.platformFee}</span>
                    </div>
                    <Separator className="bg-border/50" />
                    <div className="flex justify-between font-semibold">
                      <span>Total</span>
                      <span className="text-primary">${interview.totalEscrow}</span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'w-full justify-center mt-2',
                      interview.status === 'verified_paid'
                        ? 'border-green-500/30 text-green-600 bg-green-500/10'
                        : 'border-amber-500/30 text-amber-600 bg-amber-500/10'
                    )}
                  >
                    {interview.status === 'verified_paid' ? 'Paid & Released' : 'In Escrow'}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
};

export default CompanyReviewPanel;
