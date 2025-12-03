import { useState } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InterviewAvailability, DAYS_OF_WEEK } from '@/types/Interview';
import { Skeleton } from '@/components/ui/skeleton';

interface AvailabilityCalendarProps {
  availability: InterviewAvailability[];
  loading: boolean;
  onSetAvailability: (dayOfWeek: number, startTime: string, endTime: string) => Promise<void>;
  onToggleAvailability: (dayOfWeek: number, isActive: boolean) => Promise<void>;
  onRemoveAvailability: (dayOfWeek: number) => Promise<void>;
  onSetDefault: () => Promise<void>;
}

const TIME_OPTIONS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00',
];

const formatTime = (time: string) => {
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

const AvailabilityCalendar = ({
  availability,
  loading,
  onSetAvailability,
  onToggleAvailability,
  onRemoveAvailability,
  onSetDefault,
}: AvailabilityCalendarProps) => {
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editTimes, setEditTimes] = useState({ start: '09:00', end: '17:00' });

  const getAvailabilityForDay = (dayOfWeek: number) => {
    return availability.find((a) => a.day_of_week === dayOfWeek);
  };

  const handleSaveTime = async (dayOfWeek: number) => {
    await onSetAvailability(dayOfWeek, editTimes.start, editTimes.end);
    setEditingDay(null);
  };

  const startEditing = (dayOfWeek: number) => {
    const existing = getAvailabilityForDay(dayOfWeek);
    if (existing) {
      setEditTimes({
        start: existing.start_time.slice(0, 5),
        end: existing.end_time.slice(0, 5),
      });
    } else {
      setEditTimes({ start: '09:00', end: '17:00' });
    }
    setEditingDay(dayOfWeek);
  };

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Weekly Availability
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Weekly Availability
        </CardTitle>
        {availability.length === 0 && (
          <Button size="sm" variant="outline" onClick={onSetDefault}>
            Set Default (Mon-Fri)
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {DAYS_OF_WEEK.map((day) => {
          const dayAvailability = getAvailabilityForDay(day.value);
          const isEditing = editingDay === day.value;

          return (
            <div
              key={day.value}
              className={`p-3 rounded-lg border ${
                dayAvailability?.is_active
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border bg-background'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {dayAvailability && (
                    <Switch
                      checked={dayAvailability.is_active ?? false}
                      onCheckedChange={(checked) =>
                        onToggleAvailability(day.value, checked)
                      }
                    />
                  )}
                  <Label className="font-medium text-foreground w-24">
                    {day.label}
                  </Label>
                </div>

                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={editTimes.start}
                      onValueChange={(v) => setEditTimes({ ...editTimes, start: v })}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map((time) => (
                          <SelectItem key={time} value={time}>
                            {formatTime(time)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground">to</span>
                    <Select
                      value={editTimes.end}
                      onValueChange={(v) => setEditTimes({ ...editTimes, end: v })}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map((time) => (
                          <SelectItem key={time} value={time}>
                            {formatTime(time)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => handleSaveTime(day.value)}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingDay(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : dayAvailability ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {formatTime(dayAvailability.start_time.slice(0, 5))} -{' '}
                      {formatTime(dayAvailability.end_time.slice(0, 5))}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEditing(day.value)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemoveAvailability(day.value)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startEditing(day.value)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Hours
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        <p className="text-xs text-muted-foreground mt-4">
          Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
      </CardContent>
    </Card>
  );
};

export default AvailabilityCalendar;
