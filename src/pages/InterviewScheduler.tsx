import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings, Calendar, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInterviews } from '@/hooks/useInterviews';
import UpcomingInterviews from '@/components/interview/UpcomingInterviews';
import ScheduleInterviewDialog from '@/components/interview/ScheduleInterviewDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const InterviewScheduler = () => {
  const navigate = useNavigate();
  const {
    upcomingInterviews,
    todayInterviews,
    interviewTypes,
    loading,
    scheduleInterview,
    cancelInterview,
    updateInterview,
  } = useInterviews();

  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

  const handleComplete = (id: string) => {
    updateInterview(id, { status: 'completed' });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
              className="hover:bg-primary/10"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Interview Scheduler
              </h1>
              <p className="text-muted-foreground">
                Schedule and manage candidate interviews
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => navigate('/interview-scheduler/settings')}
            >
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button onClick={() => setIsScheduleDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Schedule Interview
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Today's Interviews
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {todayInterviews.length}
                </span>
                {todayInterviews.length > 0 && (
                  <Badge className="bg-primary/10 text-primary border-primary/20">
                    Active
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Upcoming This Week
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-3xl font-bold text-foreground">
                {upcomingInterviews.filter((i) => {
                  const weekFromNow = new Date();
                  weekFromNow.setDate(weekFromNow.getDate() + 7);
                  return new Date(i.scheduled_at) < weekFromNow;
                }).length}
              </span>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Interview Types
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {interviewTypes.length}
                </span>
                {interviewTypes.length === 0 && (
                  <Button
                    size="sm"
                    variant="link"
                    className="text-primary p-0 h-auto"
                    onClick={() => navigate('/interview-scheduler/settings')}
                  >
                    Configure
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <UpcomingInterviews
              interviews={upcomingInterviews}
              interviewTypes={interviewTypes}
              loading={loading}
              onCancel={cancelInterview}
              onComplete={handleComplete}
            />
          </div>

          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => setIsScheduleDialogOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Schedule New Interview
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => navigate('/interview-scheduler/settings')}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Manage Availability
                </Button>
              </CardContent>
            </Card>

            {/* Today's Schedule */}
            {todayInterviews.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">
                    Today's Schedule
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {todayInterviews.map((interview) => (
                    <div
                      key={interview.id}
                      className="p-3 rounded-lg bg-primary/5 border border-primary/20"
                    >
                      <p className="font-medium text-foreground">
                        {interview.candidate_name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(interview.scheduled_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        • {interview.duration_minutes} min
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <ScheduleInterviewDialog
        open={isScheduleDialogOpen}
        onOpenChange={setIsScheduleDialogOpen}
        interviewTypes={interviewTypes}
        onSchedule={scheduleInterview}
      />
    </div>
  );
};

export default InterviewScheduler;
