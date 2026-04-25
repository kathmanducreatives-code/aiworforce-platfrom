import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PlanDetailView from '@/components/chat/PlanDetailView';

export default function TaskPlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  return (
    <div className="px-6 py-5">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>
      {planId ? (
        <PlanDetailView planId={planId} />
      ) : (
        <div className="text-muted-foreground">No plan id.</div>
      )}
    </div>
  );
}
