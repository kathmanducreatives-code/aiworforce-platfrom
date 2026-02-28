import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Calendar, Video, ClipboardCheck } from 'lucide-react';
import ExpertDirectory from '@/components/expert-marketplace/ExpertDirectory';
import BookingWorkflow from '@/components/expert-marketplace/BookingWorkflow';
import InterviewHub from '@/components/expert-marketplace/InterviewHub';
import CompanyReviewPanel from '@/components/expert-marketplace/CompanyReviewPanel';
import { Expert } from '@/components/expert-marketplace/mockData';

const ExpertMarketplace = () => {
  const [selectedExpert, setSelectedExpert] = useState<Expert | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);

  const handleRequestExpert = (expert: Expert) => {
    setSelectedExpert(expert);
    setBookingOpen(true);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Expert Interview Marketplace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Book verified technical experts for Round 2 candidate interviews
        </p>
      </div>

      <Tabs defaultValue="directory" className="w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-xl">
          <TabsTrigger value="directory" className="flex items-center gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" /> Expert Pool
          </TabsTrigger>
          <TabsTrigger value="requests" className="flex items-center gap-1.5 text-xs">
            <Calendar className="h-3.5 w-3.5" /> Requests
          </TabsTrigger>
          <TabsTrigger value="hub" className="flex items-center gap-1.5 text-xs">
            <Video className="h-3.5 w-3.5" /> Interview Hub
          </TabsTrigger>
          <TabsTrigger value="reviews" className="flex items-center gap-1.5 text-xs">
            <ClipboardCheck className="h-3.5 w-3.5" /> Reviews
          </TabsTrigger>
        </TabsList>

        <TabsContent value="directory" className="mt-6">
          <ExpertDirectory onRequestExpert={handleRequestExpert} />
        </TabsContent>

        <TabsContent value="requests" className="mt-6">
          <RequestsOverview />
        </TabsContent>

        <TabsContent value="hub" className="mt-6">
          <InterviewHub />
        </TabsContent>

        <TabsContent value="reviews" className="mt-6">
          <CompanyReviewPanel />
        </TabsContent>
      </Tabs>

      <BookingWorkflow
        expert={selectedExpert}
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
      />
    </div>
  );
};

// Simple requests overview tab
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { mockInterviewRequests } from '@/components/expert-marketplace/mockData';
import StatusBadgeMarketplace from '@/components/expert-marketplace/StatusBadgeMarketplace';
import { format } from 'date-fns';
import { DollarSign, Clock } from 'lucide-react';

const RequestsOverview = () => (
  <div className="space-y-3">
    {mockInterviewRequests.map(req => (
      <Card key={req.id}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-foreground">{req.candidateName}</h4>
              <p className="text-sm text-muted-foreground">{req.position} — {req.company}</p>
              <div className="flex gap-1.5 mt-2">
                {req.techStack.map(t => (
                  <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusBadgeMarketplace status={req.status} />
              {req.expertName && (
                <span className="text-xs text-muted-foreground">Expert: {req.expertName}</span>
              )}
              {req.scheduledAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {format(new Date(req.scheduledAt), 'MMM d, h:mm a')}
                </span>
              )}
              <span className="text-xs font-medium flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> ${req.totalEscrow} escrow
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);

export default ExpertMarketplace;
