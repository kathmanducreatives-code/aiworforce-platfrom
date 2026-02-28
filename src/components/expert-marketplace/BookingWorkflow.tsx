import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CalendarIcon, Clock, DollarSign, ShieldCheck, Star } from 'lucide-react';
import { Expert } from './mockData';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface BookingWorkflowProps {
  expert: Expert | null;
  open: boolean;
  onClose: () => void;
}

const timeSlots = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

const BookingWorkflow = ({ expert, open, onClose }: BookingWorkflowProps) => {
  const [step, setStep] = useState(1);
  const [candidateName, setCandidateName] = useState('');
  const [position, setPosition] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState('');

  if (!expert) return null;

  const handleSubmit = () => {
    toast.success('Interview request submitted!', {
      description: `${expert.name} will be notified to confirm the booking.`,
    });
    onClose();
    setStep(1);
    setCandidateName('');
    setPosition('');
    setSelectedDate(undefined);
    setSelectedTime('');
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request Expert Interview</DialogTitle>
          <DialogDescription>Book a Round 2 technical interview with a verified expert</DialogDescription>
        </DialogHeader>

        {/* Expert Summary */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
            {expert.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm">{expert.name}</span>
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            </div>
            <p className="text-xs text-muted-foreground">{expert.title}</p>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
            <span className="font-medium">{expert.qualityScore}</span>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Candidate Name</Label>
              <Input placeholder="e.g. James Rivera" value={candidateName} onChange={e => setCandidateName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Position</Label>
              <Input placeholder="e.g. Senior Backend Engineer" value={position} onChange={e => setPosition(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tech Stack Focus</Label>
              <div className="flex flex-wrap gap-1.5">
                {expert.specializations.map(s => (
                  <Badge key={s} variant="secondary">{s}</Badge>
                ))}
              </div>
            </div>
            <Button className="w-full" disabled={!candidateName || !position} onClick={() => setStep(2)}>
              Continue to Scheduling
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-full justify-start text-left', !selectedDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDate ? format(selectedDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => date < new Date()}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Select Time Slot</Label>
              <div className="grid grid-cols-4 gap-2">
                {timeSlots.map(t => (
                  <Button
                    key={t}
                    size="sm"
                    variant={selectedTime === t ? 'default' : 'outline'}
                    onClick={() => setSelectedTime(t)}
                    className="text-xs"
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Payment Summary */}
            <Card>
              <CardContent className="p-4 space-y-2">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4" /> Payment Summary
                </h4>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Interview Fee (1hr)</span>
                    <span className="font-medium">${expert.hourlyRate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Platform Service Fee (20%)</span>
                    <span className="font-medium">${Math.round(expert.hourlyRate * 0.2)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Total Escrow Amount</span>
                    <span className="text-primary">${expert.hourlyRate + Math.round(expert.hourlyRate * 0.2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
              <Button className="flex-1" disabled={!selectedDate || !selectedTime} onClick={handleSubmit}>
                Confirm & Book
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default BookingWorkflow;
