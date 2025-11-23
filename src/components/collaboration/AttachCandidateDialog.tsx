import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CandidateSource } from "@/types/Collaboration";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus } from "lucide-react";

interface AttachCandidateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  onAttached: () => void;
}

const AttachCandidateDialog = ({ open, onOpenChange, roomId, onAttached }: AttachCandidateDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<CandidateSource>('resume_screening');

  const searchCandidates = async (source: CandidateSource) => {
    setLoading(true);
    try {
      let query = supabase.from(getTableName(source)).select('*');
      
      if (search) {
        query = query.ilike('candidate_name', `%${search}%`);
      }

      const { data, error } = await query.limit(10);
      if (error) throw error;
      setCandidates(data || []);
    } catch (error) {
      console.error('Error searching candidates:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTableName = (source: CandidateSource) => {
    switch (source) {
      case 'resume_screening': return 'resume_analyses';
      case 'deep_search': return 'deep_search_results';
      case 'linkedin_scraper': return 'linkedin_leads';
    }
  };

  const handleAttach = async (candidateId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('collaboration_candidate_attachments')
        .insert({
          room_id: roomId,
          candidate_source: activeTab,
          candidate_id: candidateId,
          attached_by: user.id,
        });

      if (error) throw error;

      toast({
        title: "Candidate attached",
        description: "Candidate has been added to the room",
      });

      onAttached();
      onOpenChange(false);
    } catch (error: any) {
      if (error.code === '23505') {
        toast({
          title: "Already attached",
          description: "This candidate is already in the room",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to attach candidate",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attach Candidate</DialogTitle>
          <DialogDescription>
            Search and attach candidates from any source to this room
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CandidateSource)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="resume_screening">Resume</TabsTrigger>
            <TabsTrigger value="deep_search">Deep Search</TabsTrigger>
            <TabsTrigger value="linkedin_scraper">LinkedIn</TabsTrigger>
          </TabsList>

          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={() => searchCandidates(activeTab)} disabled={loading}>
              Search
            </Button>
          </div>

          <TabsContent value={activeTab} className="mt-4 space-y-2 max-h-96 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {loading ? 'Searching...' : 'No candidates found. Try searching.'}
              </p>
            ) : (
              candidates.map((candidate) => (
                <div
                  key={candidate.id}
                  className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {candidate.candidate_name}
                    </p>
                    {candidate.job_title && (
                      <p className="text-sm text-muted-foreground">
                        {candidate.job_title} {candidate.company && `• ${candidate.company}`}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleAttach(candidate.id)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Attach
                  </Button>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default AttachCandidateDialog;
