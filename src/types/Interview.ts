export type InterviewLocationType = 'video' | 'phone' | 'in_person';
export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled';
export type SlotStatus = 'available' | 'booked' | 'blocked';
export type ReminderType = '24h' | '1h' | '15min';

export interface InterviewType {
  id: string;
  name: string;
  duration_minutes: number;
  description: string | null;
  location_type: InterviewLocationType;
  meeting_link_template: string | null;
  buffer_minutes: number | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_active: boolean | null;
}

export interface InterviewAvailability {
  id: string;
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface InterviewSlot {
  id: string;
  recruiter_id: string;
  interview_type_id: string;
  start_time: string;
  end_time: string;
  status: SlotStatus;
  booking_token: string | null;
  created_at: string | null;
  updated_at: string | null;
  interview_type?: InterviewType;
}

export interface Interview {
  id: string;
  slot_id: string | null;
  candidate_id: string | null;
  candidate_source: 'resume_screening' | 'deep_search' | 'linkedin_scraper' | 'screening_flow' | null;
  candidate_name: string;
  candidate_email: string;
  interview_type_id: string | null;
  recruiter_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: InterviewStatus;
  meeting_link: string | null;
  location: string | null;
  notes: string | null;
  feedback: string | null;
  reminder_24h_sent: boolean | null;
  reminder_1h_sent: boolean | null;
  reminder_15min_sent: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  interview_type?: InterviewType;
}

export interface InterviewReminder {
  id: string;
  interview_id: string;
  reminder_type: ReminderType;
  sent_at: string | null;
  status: string | null;
  error_message: string | null;
}

export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export const LOCATION_TYPE_LABELS: Record<InterviewLocationType, string> = {
  video: 'Video Call',
  phone: 'Phone Call',
  in_person: 'In Person',
};

export const STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
  rescheduled: 'Rescheduled',
};
