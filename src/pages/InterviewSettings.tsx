import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInterviews } from '@/hooks/useInterviews';
import { useAvailability } from '@/hooks/useAvailability';
import AvailabilityCalendar from '@/components/interview/AvailabilityCalendar';
import InterviewTypeManager from '@/components/interview/InterviewTypeManager';

const InterviewSettings = () => {
  const navigate = useNavigate();
  const {
    interviewTypes,
    loading: typesLoading,
    createInterviewType,
    updateInterviewType,
    deleteInterviewType,
  } = useInterviews();

  const {
    availability,
    loading: availabilityLoading,
    setDayAvailability,
    toggleDayAvailability,
    removeDayAvailability,
    setDefaultAvailability,
  } = useAvailability();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/interview-scheduler')}
            className="hover:bg-primary/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Interview Settings
            </h1>
            <p className="text-muted-foreground">
              Configure your availability and interview types
            </p>
          </div>
        </div>

        {/* Settings Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AvailabilityCalendar
            availability={availability}
            loading={availabilityLoading}
            onSetAvailability={setDayAvailability}
            onToggleAvailability={toggleDayAvailability}
            onRemoveAvailability={removeDayAvailability}
            onSetDefault={setDefaultAvailability}
          />

          <InterviewTypeManager
            interviewTypes={interviewTypes}
            loading={typesLoading}
            onCreate={createInterviewType}
            onUpdate={updateInterviewType}
            onDelete={deleteInterviewType}
          />
        </div>
      </div>
    </div>
  );
};

export default InterviewSettings;
