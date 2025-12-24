import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, Check, Briefcase } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { JobPosting } from "@/pages/JobBoard";

interface PostToBoardsDialogProps {
  job: JobPosting | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (job: JobPosting, boards: Record<string, { status: string; posted_at: string; url?: string }>) => void;
}

interface JobBoard {
  id: string;
  name: string;
  logo: string;
  color: string;
  getPostUrl: (job: JobPosting) => string;
}

const jobBoards: JobBoard[] = [
  {
    id: "indeed",
    name: "Indeed",
    logo: "I",
    color: "bg-blue-600",
    getPostUrl: (job) => {
      const params = new URLSearchParams({
        q: job.title,
        l: job.location,
      });
      return `https://employers.indeed.com/j#post/job?${params.toString()}`;
    },
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    logo: "in",
    color: "bg-[#0077B5]",
    getPostUrl: (job) => {
      return `https://www.linkedin.com/talent/jobs/post/new`;
    },
  },
  {
    id: "glassdoor",
    name: "Glassdoor",
    logo: "G",
    color: "bg-[#0CAA41]",
    getPostUrl: (job) => {
      return `https://www.glassdoor.com/employers/post-job`;
    },
  },
];

const PostToBoardsDialog = ({ job, open, onOpenChange, onUpdate }: PostToBoardsDialogProps) => {
  if (!job) return null;

  const handlePostToBoard = (board: JobBoard) => {
    // Open the job board posting page in a new tab
    const url = board.getPostUrl(job);
    window.open(url, "_blank");

    // Update the posted_boards status
    const updatedBoards = {
      ...job.posted_boards,
      [board.id]: {
        status: "posted",
        posted_at: new Date().toISOString(),
        url: url,
      },
    };

    onUpdate(job, updatedBoards);
    
    toast({
      title: `Opening ${board.name}`,
      description: "The job board posting page has been opened in a new tab. Copy your job details to complete the posting.",
    });
  };

  const isPosted = (boardId: string) => {
    return job.posted_boards?.[boardId]?.status === "posted";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            Post to Job Boards
          </DialogTitle>
          <DialogDescription>
            Click on a job board to open their posting page. Your job details will be ready to copy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Job Summary */}
          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <h3 className="font-semibold text-foreground">{job.title}</h3>
              <p className="text-sm text-muted-foreground">{job.company_name} • {job.location}</p>
            </CardContent>
          </Card>

          {/* Job Boards */}
          <div className="space-y-3">
            {jobBoards.map((board) => (
              <Card 
                key={board.id}
                className={`cursor-pointer transition-all hover:border-primary/50 ${
                  isPosted(board.id) ? "border-green-500/50 bg-green-500/5" : ""
                }`}
                onClick={() => handlePostToBoard(board)}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${board.color} flex items-center justify-center text-white font-bold`}>
                      {board.logo}
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground">{board.name}</h4>
                      <p className="text-xs text-muted-foreground">
                        {isPosted(board.id) ? "Already posted" : "Click to post"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPosted(board.id) ? (
                      <Check className="h-5 w-5 text-green-500" />
                    ) : (
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Job Details to Copy */}
          <div className="pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground mb-2">Quick copy job details:</p>
            <div className="bg-muted rounded-lg p-3 text-sm">
              <p><strong>Title:</strong> {job.title}</p>
              <p><strong>Company:</strong> {job.company_name}</p>
              <p><strong>Location:</strong> {job.location}</p>
              <p><strong>Type:</strong> {job.job_type}</p>
              {job.salary_min && job.salary_max && (
                <p><strong>Salary:</strong> {job.salary_currency} {job.salary_min.toLocaleString()} - {job.salary_max.toLocaleString()}</p>
              )}
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-2 w-full"
              onClick={() => {
                const text = `${job.title}\n${job.company_name}\n${job.location}\n\n${job.description}`;
                navigator.clipboard.writeText(text);
                toast({ title: "Job details copied to clipboard" });
              }}
            >
              Copy Full Description
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PostToBoardsDialog;
