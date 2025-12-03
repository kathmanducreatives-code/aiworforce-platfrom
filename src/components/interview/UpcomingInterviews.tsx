import { format, isToday, isTomorrow, differenceInMinutes } from 'date-fns';
import { Calendar, Clock, Video, Phone, MapPin, User, MoreVertical, X, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Interview, InterviewType, LOCATION_TYPE_LABELS, STATUS_LABELS } from '@/types/Interview';
import { Skeleton } from '@/components/ui/skeleton';

interface UpcomingInterviewsProps {
  interviews: Interview[];
  interviewTypes: InterviewType[];
  loading: boolean;
  onCancel: (id: string) => void;
  onComplete: (id: string) => void;
  onReschedule?: (interview: Interview) => void;
}

const UpcomingInterviews = ({
  interviews,
  interviewTypes,
  loading,
  onCancel,
  onComplete,
  onReschedule,
}: UpcomingInterviewsProps) => {
  const getInterviewType = (typeId: string | null) => {
    return interviewTypes.find((t) => t.id === typeId);
  };

  const getLocationIcon = (locationType: string) => {
    switch (locationType) {
      case 'video':
        return <Video className="h-4 w-4" />;
      case 'phone':
        return <Phone className="h-4 w-4" />;
      default:
        return <MapPin className="h-4 w-4" />;
    }
  };

  const getDateLabel = (date: Date) => {
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'EEEE, MMM d');
  };

  const getTimeUntil = (date: Date) => {
    const minutes = differenceInMinutes(date, new Date());
    if (minutes < 60) return `in ${minutes} min`;
    if (minutes < 1440) return `in ${Math.round(minutes / 60)} hours`;
    return `in ${Math.round(minutes / 1440)} days`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'completed':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'cancelled':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'no_show':
        return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Upcoming Interviews
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Upcoming Interviews
          {interviews.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {interviews.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {interviews.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No upcoming interviews</p>
            <p className="text-sm mt-1">Schedule interviews with your candidates</p>
          </div>
        ) : (
          <div className="space-y-3">
            {interviews.map((interview) => {
              const interviewType = getInterviewType(interview.interview_type_id);
              const scheduledDate = new Date(interview.scheduled_at);
              const isUpcoming = scheduledDate > new Date();

              return (
                <div
                  key={interview.id}
                  className="p-4 rounded-lg border border-border bg-background hover:bg-accent/5 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">
                          {interview.candidate_name}
                        </span>
                        <Badge className={getStatusColor(interview.status)}>
                          {STATUS_LABELS[interview.status]}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>{getDateLabel(scheduledDate)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          <span>
                            {format(scheduledDate, 'h:mm a')} ({interview.duration_minutes} min)
                          </span>
                        </div>
                        {interviewType && (
                          <div className="flex items-center gap-1">
                            {getLocationIcon(interviewType.location_type)}
                            <span>{LOCATION_TYPE_LABELS[interviewType.location_type]}</span>
                          </div>
                        )}
                      </div>

                      {interviewType && (
                        <div className="mt-2">
                          <Badge variant="outline" className="text-xs">
                            {interviewType.name}
                          </Badge>
                        </div>
                      )}

                      {isUpcoming && (
                        <p className="text-xs text-primary mt-2">
                          {getTimeUntil(scheduledDate)}
                        </p>
                      )}
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {interview.meeting_link && (
                          <DropdownMenuItem
                            onClick={() => window.open(interview.meeting_link!, '_blank')}
                          >
                            <Video className="h-4 w-4 mr-2" />
                            Join Meeting
                          </DropdownMenuItem>
                        )}
                        {interview.status === 'scheduled' && (
                          <>
                            <DropdownMenuItem onClick={() => onComplete(interview.id)}>
                              <Check className="h-4 w-4 mr-2" />
                              Mark Complete
                            </DropdownMenuItem>
                            {onReschedule && (
                              <DropdownMenuItem onClick={() => onReschedule(interview)}>
                                <Calendar className="h-4 w-4 mr-2" />
                                Reschedule
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => onCancel(interview.id)}
                              className="text-destructive"
                            >
                              <X className="h-4 w-4 mr-2" />
                              Cancel Interview
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UpcomingInterviews;
