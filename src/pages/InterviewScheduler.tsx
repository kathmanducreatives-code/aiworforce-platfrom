import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Plus, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { useInterviews } from '@/hooks/useInterviews';
import InterviewCalendarView from '@/components/interview/InterviewCalendarView';
import InterviewNotesDialog from '@/components/interview/InterviewNotesDialog';
import SimpleScheduleDialog from '@/components/interview/SimpleScheduleDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Interview } from '@/types/Interview';
import { format, isToday, isTomorrow } from 'date-fns';

const InterviewScheduler = () => {
  const navigate = useNavigate();
  const {
    interviews,
    upcomingInterviews,
    todayInterviews,
    loading,
    scheduleInterview,
    cancelInterview,
    updateInterview,
  } = useInterviews();

  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [selectedInterview, setSelectedInterview] = useState<Interview | null>(null);
  const [isNotesDialogOpen, setIsNotesDialogOpen] = useState(false);

  const handleComplete = (id: string) => {
    updateInterview(id, { status: 'completed' });
  };

  const handleUpdateNotes = async (id: string, notes: string) => {
    await updateInterview(id, { notes });
  };

  const handleSelectInterview = (interview: Interview) => {
    setSelectedInterview(interview);
    setIsNotesDialogOpen(true);
  };

  const handleScheduleInterview = async (interviewData: Partial<Interview>, sendEmailInvite: boolean) => {
    const result = await scheduleInterview(interviewData, sendEmailInvite);

    return result;
  };

  const getDateLabel = (date: Date) => {
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'EEEE, MMM d');
  };

  // Filter only scheduled interviews for calendar
  const scheduledInterviews = interviews.filter(i => i.status === 'scheduled');

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6 space-y-6">
        <PageHeader
          title="Interview Scheduler"
          subtitle="Schedule and manage candidate interviews"
          breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Interviews' }]}
          primaryAction={{
            label: 'Schedule Interview',
            onClick: () => setIsScheduleDialogOpen(true),
            icon: <Plus className="h-4 w-4" />,
          }}
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:col-span-4">
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
                  Total Scheduled
                </CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-3xl font-bold text-foreground">
                  {upcomingInterviews.length}
                </span>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start auto-rows-min">
          {/* Calendar View */}
          <div className="lg:col-span-2">
            <InterviewCalendarView
              interviews={scheduledInterviews}
              onSelectInterview={handleSelectInterview}
            />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Today's Schedule */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  Today's Schedule
                </CardTitle>
              </CardHeader>
              <CardContent>
                {todayInterviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No interviews scheduled for today
                  </p>
                ) : (
                  <div className="space-y-2">
                    {todayInterviews.map((interview) => (
                      <button
                        key={interview.id}
                        onClick={() => handleSelectInterview(interview)}
                        className="w-full text-left p-3 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors"
                      >
                        <p className="font-medium text-foreground truncate">
                          {interview.candidate_name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(interview.scheduled_at), 'h:mm a')}{' '}
                          • {interview.duration_minutes} min
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Upcoming Interviews */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-primary" />
                  Upcoming
                </CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingInterviews.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground mb-3">
                      No upcoming interviews
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full justify-center"
                      onClick={() => setIsScheduleDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Schedule One
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {upcomingInterviews.slice(0, 5).map((interview) => {
                      const scheduledDate = new Date(interview.scheduled_at);
                      return (
                        <button
                          key={interview.id}
                          onClick={() => handleSelectInterview(interview)}
                          className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent/5 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-medium text-foreground truncate">
                              {interview.candidate_name}
                            </p>
                            <Badge variant="outline" className="text-xs">
                              {getDateLabel(scheduledDate)}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {format(scheduledDate, 'h:mm a')} • {interview.duration_minutes} min
                          </p>
                        </button>
                      );
                    })}
                    {upcomingInterviews.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center pt-2">
                        +{upcomingInterviews.length - 5} more interviews
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <SimpleScheduleDialog
        open={isScheduleDialogOpen}
        onOpenChange={setIsScheduleDialogOpen}
        onSchedule={handleScheduleInterview}
      />

      <InterviewNotesDialog
        interview={selectedInterview}
        open={isNotesDialogOpen}
        onOpenChange={setIsNotesDialogOpen}
        onUpdateNotes={handleUpdateNotes}
        onCancel={cancelInterview}
        onComplete={handleComplete}
      />
    </div>
  );
};

export default InterviewScheduler;
