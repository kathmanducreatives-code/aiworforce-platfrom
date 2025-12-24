import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Edit, Trash2, Share2, ExternalLink, Briefcase } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { JobPosting } from "@/pages/JobBoard";
import { format } from "date-fns";

interface JobListingsTableProps {
  jobs: JobPosting[];
  isLoading: boolean;
  onEdit: (job: JobPosting) => void;
  onDelete: (id: string) => void;
  onPostToBoards: (job: JobPosting) => void;
}

const JobListingsTable = ({ jobs, isLoading, onEdit, onDelete, onPostToBoards }: JobListingsTableProps) => {
  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      draft: { variant: "secondary", label: "Draft" },
      active: { variant: "default", label: "Active" },
      closed: { variant: "destructive", label: "Closed" },
    };
    const { variant, label } = variants[status] || variants.draft;
    return <Badge variant={variant}>{label}</Badge>;
  };

  const getBoardIcons = (postedBoards: Record<string, any>) => {
    const boards = ["indeed", "linkedin", "glassdoor"];
    return (
      <div className="flex gap-1">
        {boards.map((board) => {
          const isPosted = postedBoards?.[board]?.status === "posted";
          return (
            <div
              key={board}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                isPosted 
                  ? "bg-green-500/20 text-green-500 border border-green-500/30" 
                  : "bg-muted text-muted-foreground border border-border"
              }`}
              title={`${board.charAt(0).toUpperCase() + board.slice(1)}: ${isPosted ? "Posted" : "Not posted"}`}
            >
              {board.charAt(0).toUpperCase()}
            </div>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle>Job Postings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardContent className="py-16 text-center">
          <Briefcase className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No job postings yet</h3>
          <p className="text-muted-foreground">Create your first job posting to start attracting candidates.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader>
        <CardTitle>Job Postings ({jobs.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job Title</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Posted To</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id} className="hover:bg-muted/50">
                <TableCell className="font-medium">{job.title}</TableCell>
                <TableCell>{job.company_name}</TableCell>
                <TableCell>{job.location}</TableCell>
                <TableCell className="capitalize">{job.job_type.replace("-", " ")}</TableCell>
                <TableCell>{getStatusBadge(job.status)}</TableCell>
                <TableCell>{getBoardIcons(job.posted_boards)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(job.created_at), "MMM d, yyyy")}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(job)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onPostToBoards(job)}>
                        <Share2 className="h-4 w-4 mr-2" />
                        Post to Boards
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => onDelete(job.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default JobListingsTable;
