import { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths } from 'date-fns';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, Video, Phone, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Interview } from '@/types/Interview';
import { cn } from '@/lib/utils';

interface InterviewCalendarViewProps {
  interviews: Interview[];
  onSelectInterview: (interview: Interview) => void;
}

const InterviewCalendarView = ({ interviews, onSelectInterview }: InterviewCalendarViewProps) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getInterviewsForDay = (day: Date) => {
    return interviews.filter((interview) =>
      isSameDay(new Date(interview.scheduled_at), day)
    );
  };

  const getLocationIcon = (locationType?: string) => {
    switch (locationType) {
      case 'video':
        return <Video className="h-3 w-3" />;
      case 'phone':
        return <Phone className="h-3 w-3" />;
      default:
        return <MapPin className="h-3 w-3" />;
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Interview Calendar
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div
              key={day}
              className="text-center text-xs font-medium text-muted-foreground py-2"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const dayInterviews = getInterviewsForDay(day);
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'min-h-[80px] p-1 rounded-lg border border-border/50 transition-colors',
                  isCurrentMonth ? 'bg-background' : 'bg-muted/30',
                  isToday && 'ring-1 ring-primary bg-primary/5'
                )}
              >
                <div
                  className={cn(
                    'text-xs font-medium mb-1 px-1',
                    !isCurrentMonth && 'text-muted-foreground',
                    isToday && 'text-primary'
                  )}
                >
                  {format(day, 'd')}
                </div>
                <div className="space-y-1">
                  {dayInterviews.slice(0, 2).map((interview) => (
                    <button
                      key={interview.id}
                      onClick={() => onSelectInterview(interview)}
                      className="w-full text-left p-1 rounded text-xs bg-primary/10 hover:bg-primary/20 transition-colors border border-primary/20"
                    >
                      <div className="flex items-center gap-1 truncate">
                        <Clock className="h-2.5 w-2.5 flex-shrink-0 text-primary" />
                        <span className="truncate font-medium">
                          {format(new Date(interview.scheduled_at), 'h:mm a')}
                        </span>
                      </div>
                      <div className="truncate text-muted-foreground">
                        {interview.candidate_name}
                      </div>
                    </button>
                  ))}
                  {dayInterviews.length > 2 && (
                    <div className="text-xs text-muted-foreground px-1">
                      +{dayInterviews.length - 2} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default InterviewCalendarView;
