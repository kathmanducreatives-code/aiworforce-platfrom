import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Clock, Video, Phone, MapPin, User, Mail } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { InterviewType, Interview, LOCATION_TYPE_LABELS } from '@/types/Interview';
import { cn } from '@/lib/utils';

interface ScheduleInterviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interviewTypes: InterviewType[];
  onSchedule: (interview: Partial<Interview>) => Promise<Interview | null>;
  candidate?: {
    id: string;
    name: string;
    email: string;
    source: 'resume_screening' | 'deep_search' | 'linkedin_scraper' | 'screening_flow';
  };
}

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00',
];

const formatTimeDisplay = (time: string) => {
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

const ScheduleInterviewDialog = ({
  open,
  onOpenChange,
  interviewTypes,
  onSchedule,
  candidate,
}: ScheduleInterviewDialogProps) => {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState('09:00');
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [candidateName, setCandidateName] = useState(candidate?.name || '');
  const [candidateEmail, setCandidateEmail] = useState(candidate?.email || '');
  const [meetingLink, setMeetingLink] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

  const selectedType = interviewTypes.find((t) => t.id === selectedTypeId);

  const handleSchedule = async () => {
    if (!date || !selectedTypeId || !candidateName || !candidateEmail) return;

    setIsScheduling(true);
    try {
      const [hours, minutes] = time.split(':');
      const scheduledAt = new Date(date);
      scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const interview: Partial<Interview> = {
        candidate_id: candidate?.id,
        candidate_source: candidate?.source,
        candidate_name: candidateName,
        candidate_email: candidateEmail,
        interview_type_id: selectedTypeId,
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: selectedType?.duration_minutes || 30,
        meeting_link: meetingLink || selectedType?.meeting_link_template || null,
        location: location || null,
        notes: notes || null,
        status: 'scheduled',
      };

      const result = await onSchedule(interview);
      if (result) {
        onOpenChange(false);
        // Reset form
        setDate(undefined);
        setTime('09:00');
        setSelectedTypeId('');
        setCandidateName('');
        setCandidateEmail('');
        setMeetingLink('');
        setLocation('');
        setNotes('');
      }
    } finally {
      setIsScheduling(false);
    }
  };

  const getLocationIcon = (type: string) => {
    switch (type) {
      case 'video':
        return <Video className="h-4 w-4" />;
      case 'phone':
        return <Phone className="h-4 w-4" />;
      default:
        return <MapPin className="h-4 w-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Schedule Interview
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Candidate Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Candidate Name
              </Label>
              <Input
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="Enter candidate name"
                disabled={!!candidate}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <Input
                type="email"
                value={candidateEmail}
                onChange={(e) => setCandidateEmail(e.target.value)}
                placeholder="candidate@email.com"
                disabled={!!candidate}
              />
            </div>
          </div>

          {/* Interview Type */}
          <div className="space-y-2">
            <Label>Interview Type</Label>
            <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select interview type" />
              </SelectTrigger>
              <SelectContent>
                {interviewTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    <div className="flex items-center gap-2">
                      {getLocationIcon(type.location_type)}
                      <span>{type.name}</span>
                      <span className="text-muted-foreground">
                        ({type.duration_minutes} min)
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {interviewTypes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No interview types configured. Go to settings to create one.
              </p>
            )}
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !date && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Time
              </Label>
              <Select value={time} onValueChange={setTime}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {formatTimeDisplay(slot)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Meeting Link / Location */}
          {selectedType?.location_type === 'video' && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Video className="h-4 w-4" />
                Meeting Link
              </Label>
              <Input
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder={selectedType.meeting_link_template || 'https://zoom.us/j/...'}
              />
            </div>
          )}

          {selectedType?.location_type === 'in_person' && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Location
              </Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Office address or room number"
              />
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes for this interview..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={
              !date ||
              !selectedTypeId ||
              !candidateName ||
              !candidateEmail ||
              isScheduling
            }
          >
            {isScheduling ? 'Scheduling...' : 'Schedule Interview'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleInterviewDialog;
