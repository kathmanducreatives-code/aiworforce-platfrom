import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { format, addDays, startOfDay, isSameDay } from 'date-fns';
import { Calendar as CalendarIcon, Clock, CheckCircle, Video, Phone, MapPin, User, Mail, ArrowLeft, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { InterviewType, InterviewAvailability, LOCATION_TYPE_LABELS } from '@/types/Interview';

interface TimeSlot {
  time: string;
  available: boolean;
}

const BookInterview = () => {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [slotData, setSlotData] = useState<any>(null);
  const [interviewType, setInterviewType] = useState<InterviewType | null>(null);
  const [availability, setAvailability] = useState<InterviewAvailability[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [isBooked, setIsBooked] = useState(false);
  const [bookedInterview, setBookedInterview] = useState<any>(null);

  // Generate available dates for the next 2 weeks
  const availableDates = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i + 1));

  useEffect(() => {
    const fetchSlotData = async () => {
      if (!token) return;

      try {
        // Fetch the slot + interview type + availability via SECURITY DEFINER RPC
        const { data: ctx, error: ctxError } = await supabase.rpc(
          'get_interview_booking_context',
          { p_token: token }
        );

        if (ctxError || !ctx) {
          toast({
            title: 'Invalid Link',
            description: 'This booking link is no longer valid.',
            variant: 'destructive',
          });
          return;
        }

        const ctxObj = ctx as any;
        setSlotData(ctxObj.slot);
        if (ctxObj.interview_type) setInterviewType(ctxObj.interview_type as InterviewType);
        if (ctxObj.availability) setAvailability(ctxObj.availability as InterviewAvailability[]);
      } catch (error) {
        console.error('Error fetching slot data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSlotData();
  }, [token]);

  const getAvailableTimesForDate = (date: Date): TimeSlot[] => {
    const dayOfWeek = date.getDay();
    const dayAvailability = availability.find((a) => a.day_of_week === dayOfWeek);

    if (!dayAvailability) return [];

    const startHour = parseInt(dayAvailability.start_time.split(':')[0]);
    const endHour = parseInt(dayAvailability.end_time.split(':')[0]);
    const duration = interviewType?.duration_minutes || 30;

    const slots: TimeSlot[] = [];
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        if (hour * 60 + minute + duration > endHour * 60) break;
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        slots.push({ time: timeString, available: true });
      }
    }

    return slots;
  };

  const formatTimeDisplay = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleBook = async () => {
    if (!selectedDate || !selectedTime || !candidateName || !candidateEmail || !slotData) return;

    setIsBooking(true);
    try {
      const [hours, minutes] = selectedTime.split(':');
      const scheduledAt = new Date(selectedDate);
      scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      // Book interview via SECURITY DEFINER RPC (server validates token + slot atomically)
      const { data: interview, error: interviewError } = await supabase.rpc(
        'book_interview_with_token',
        {
          p_token: token!,
          p_candidate_name: candidateName,
          p_candidate_email: candidateEmail,
          p_scheduled_at: scheduledAt.toISOString(),
        }
      );

      if (interviewError) throw interviewError;

      setBookedInterview(interview);
      setIsBooked(true);

      toast({
        title: 'Interview Scheduled!',
        description: 'You will receive a confirmation email shortly.',
      });
    } catch (error: any) {
      console.error('Error booking interview:', error);
      toast({
        title: 'Booking Failed',
        description: error.message || 'Failed to book the interview. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsBooking(false);
    }
  };

  const getLocationIcon = (type: string) => {
    switch (type) {
      case 'video':
        return <Video className="h-5 w-5" />;
      case 'phone':
        return <Phone className="h-5 w-5" />;
      default:
        return <MapPin className="h-5 w-5" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-8">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!slotData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8">
            <div className="text-destructive mb-4">
              <CalendarIcon className="h-16 w-16 mx-auto opacity-50" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Invalid Booking Link</h2>
            <p className="text-muted-foreground">
              This booking link is no longer valid or has already been used.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isBooked && bookedInterview) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <div className="text-primary mb-4">
              <CheckCircle className="h-16 w-16 mx-auto" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Interview Scheduled!</h2>
            <p className="text-muted-foreground mb-6">
              Your interview has been confirmed.
            </p>

            <div className="bg-muted/50 rounded-lg p-4 text-left space-y-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                <span>{format(new Date(bookedInterview.scheduled_at), 'EEEE, MMMM d, yyyy')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>
                  {format(new Date(bookedInterview.scheduled_at), 'h:mm a')} ({bookedInterview.duration_minutes} min)
                </span>
              </div>
              {interviewType && (
                <div className="flex items-center gap-2">
                  {getLocationIcon(interviewType.location_type)}
                  <span>{LOCATION_TYPE_LABELS[interviewType.location_type]}</span>
                </div>
              )}
            </div>

            <p className="text-sm text-muted-foreground mt-6">
              A confirmation email has been sent to {candidateEmail}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const timeSlots = selectedDate ? getAvailableTimesForDate(selectedDate) : [];

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <Card className="border-border">
          <CardHeader className="border-b border-border">
            <h1 className="flex items-center gap-3 text-2xl font-semibold leading-none tracking-tight">
              <CalendarIcon className="h-6 w-6 text-primary" />
              Schedule Your Interview
            </h1>
            {interviewType && (
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="flex items-center gap-1">
                  {getLocationIcon(interviewType.location_type)}
                  {interviewType.name}
                </Badge>
                <Badge variant="secondary">
                  <Clock className="h-3 w-3 mr-1" />
                  {interviewType.duration_minutes} min
                </Badge>
              </div>
            )}
          </CardHeader>

          <CardContent className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Date Selection */}
              <div>
                <h3 className="font-semibold text-foreground mb-4">Select a Date</h3>
                <div className="grid grid-cols-2 gap-2">
                  {availableDates.map((date) => {
                    const dayOfWeek = date.getDay();
                    const hasAvailability = availability.some((a) => a.day_of_week === dayOfWeek);
                    const isSelected = selectedDate && isSameDay(date, selectedDate);

                    return (
                      <Button
                        key={date.toISOString()}
                        variant={isSelected ? 'default' : 'outline'}
                        className={`h-auto py-3 ${!hasAvailability ? 'opacity-50' : ''}`}
                        disabled={!hasAvailability}
                        onClick={() => {
                          setSelectedDate(date);
                          setSelectedTime(null);
                        }}
                      >
                        <div className="text-center">
                          <div className="text-xs opacity-70">{format(date, 'EEE')}</div>
                          <div className="font-semibold">{format(date, 'MMM d')}</div>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Time Selection */}
              <div>
                <h3 className="font-semibold text-foreground mb-4">
                  {selectedDate ? `Available Times - ${format(selectedDate, 'MMM d')}` : 'Select a time'}
                </h3>
                {selectedDate ? (
                  timeSlots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                      {timeSlots.map((slot) => (
                        <Button
                          key={slot.time}
                          variant={selectedTime === slot.time ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSelectedTime(slot.time)}
                        >
                          {formatTimeDisplay(slot.time)}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No times available for this date.</p>
                  )
                ) : (
                  <p className="text-muted-foreground">Please select a date first.</p>
                )}
              </div>
            </div>

            {/* Candidate Info */}
            {selectedDate && selectedTime && (
              <div className="mt-8 pt-6 border-t border-border">
                <h3 className="font-semibold text-foreground mb-4">Your Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Your Name
                    </Label>
                    <Input
                      value={candidateName}
                      onChange={(e) => setCandidateName(e.target.value)}
                      placeholder="Enter your full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Address
                    </Label>
                    <Input
                      type="email"
                      value={candidateEmail}
                      onChange={(e) => setCandidateEmail(e.target.value)}
                      placeholder="your@email.com"
                    />
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <Button
                    size="lg"
                    onClick={handleBook}
                    disabled={!candidateName || !candidateEmail || isBooking}
                  >
                    {isBooking ? 'Booking...' : 'Confirm Booking'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BookInterview;
