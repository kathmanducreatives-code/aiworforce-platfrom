import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Play, Download, Star, ThumbsUp, ThumbsDown, CheckCircle2, AlertCircle, DollarSign } from 'lucide-react';
import { mockInterviewRequests } from './mockData';
import StatusBadge from './StatusBadgeMarketplace';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const ratingLabels: Record<string, string> = {
  strong_hire: 'Strong Hire',
  hire: 'Hire',
  no_hire: 'No Hire',
  strong_no_hire: 'Strong No Hire',
};

const ratingColors: Record<string, string> = {
  strong_hire: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/30',
  hire: 'text-blue-600 bg-blue-500/10 border-blue-500/30',
  no_hire: 'text-amber-600 bg-amber-500/10 border-amber-500/30',
  strong_no_hire: 'text-red-600 bg-red-500/10 border-red-500/30',
};

const CompanyReviewPanel = () => {
  const completed = mockInterviewRequests.filter(r => r.scorecard);

  return (
    <div className="space-y-6">
      {completed.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-muted-foreground">No completed interviews to review yet.</p>
          </CardContent>
        </Card>
      )}

      {completed.map(interview => (
        <Card key={interview.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">{interview.candidateName}</CardTitle>
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
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Recording Placeholder */}
            <div className="bg-muted/30 border border-border rounded-xl p-6 flex items-center justify-between">
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
                <Button size="sm" variant="outline">
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
                {/* Scores */}
                <div className="md:col-span-2 space-y-4">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Star className="h-4 w-4 text-amber-500" /> Expert Scorecard
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
                      <Progress value={item.score * 20} className="h-2" />
                    </div>
                  ))}

                  <Separator />

                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">Overall Rating</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-foreground">{interview.scorecard.overallRating}</span>
                      <span className="text-sm text-muted-foreground">/5</span>
                    </div>
                  </div>

                  <Badge className={cn('text-sm', ratingColors[interview.scorecard.recommendation])} variant="outline">
                    {ratingLabels[interview.scorecard.recommendation]}
                  </Badge>

                  {/* Strengths & Concerns */}
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                        <ThumbsUp className="h-3 w-3" /> Strengths
                      </h5>
                      {interview.scorecard.strengths.map((s, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 flex-shrink-0" />
                          {s}
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-amber-600 flex items-center gap-1">
                        <ThumbsDown className="h-3 w-3" /> Concerns
                      </h5>
                      {interview.scorecard.concerns.map((c, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <AlertCircle className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Expert Notes */}
                  <div className="bg-muted/30 rounded-lg p-3 mt-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Expert Notes</p>
                    <p className="text-sm">{interview.scorecard.notes}</p>
                  </div>
                </div>

                {/* Payment Sidebar */}
                <Card>
                  <CardContent className="p-4 space-y-3">
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
                      <Separator />
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
                          ? 'border-emerald-500/30 text-emerald-600 bg-emerald-500/10'
                          : 'border-amber-500/30 text-amber-600 bg-amber-500/10'
                      )}
                    >
                      {interview.status === 'verified_paid' ? 'Paid & Released' : 'In Escrow'}
                    </Badge>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default CompanyReviewPanel;
