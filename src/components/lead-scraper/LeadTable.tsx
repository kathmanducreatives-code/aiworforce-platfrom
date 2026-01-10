import { useState } from "react";
import { ArrowUpDown, Download, ExternalLink, Mail, Brain, Trash2, Search, MoreHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { deepSearchApi } from "@/services/deepSearchApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeepSearchResults } from "./DeepSearchResults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface LinkedInLead {
  id: string;
  candidate_name: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  linkedin_url: string | null;
  contact_email: string | null;
  experience_level: string | null;
  keywords: string[] | null;
  scraped_at: string;
  session_id: string | null;
}

interface LeadTableProps {
  leads: LinkedInLead[];
  isLoading: boolean;
  onDownloadCSV: () => void;
  onLeadDeleted?: () => void;
}

type SortField = "candidate_name" | "job_title" | "company" | "scraped_at";
type SortOrder = "asc" | "desc";

export const LeadTable = ({ leads, isLoading, onDownloadCSV, onLeadDeleted }: LeadTableProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [experienceFilter, setExperienceFilter] = useState("all");
  const [showEmailOnly, setShowEmailOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>("scraped_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [runningDeepSearch, setRunningDeepSearch] = useState<Set<string>>(new Set());
  const [deletingLead, setDeletingLead] = useState<string | null>(null);
  const [leadToDelete, setLeadToDelete] = useState<{ id: string; name: string } | null>(null);
  const { toast } = useToast();

  const handleDeleteLead = async (leadId: string, leadName: string) => {
    try {
      setDeletingLead(leadId);
      const { error } = await supabase
        .from('linkedin_leads')
        .delete()
        .eq('id', leadId);

      if (error) throw error;

      toast({
        title: "Lead Deleted",
        description: `${leadName} has been removed.`,
      });

      onLeadDeleted?.();
    } catch (error) {
      console.error('Error deleting lead:', error);
      toast({
        title: "Error",
        description: "Failed to delete lead",
        variant: "destructive",
      });
    } finally {
      setDeletingLead(null);
    }
  };

  const handleRunDeepSearch = async (lead: LinkedInLead) => {
    try {
      setRunningDeepSearch(prev => new Set(prev).add(lead.id));
      
      await deepSearchApi.runDeepSearch({
        candidateId: lead.id,
        candidateName: lead.candidate_name,
        linkedinUrl: lead.linkedin_url || undefined,
        company: lead.company || undefined,
      });

      toast({
        title: "Deep Search Initiated",
        description: `AI analysis started for ${lead.candidate_name}. Results will appear shortly.`,
      });

      // Open the dialog to show results
      setSelectedCandidateId(lead.id);
    } catch (error) {
      console.error('Error running deep search:', error);
      toast({
        title: "Deep Search Failed",
        description: error instanceof Error ? error.message : "Failed to initiate deep search",
        variant: "destructive",
      });
    } finally {
      setRunningDeepSearch(prev => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const filteredAndSortedLeads = leads
    .filter((lead) => {
      const matchesSearch =
        lead.candidate_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.job_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.company?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesExperience =
        experienceFilter === "all" || lead.experience_level === experienceFilter;

      const matchesEmail = !showEmailOnly || (lead.contact_email && lead.contact_email.trim() !== "");

      return matchesSearch && matchesExperience && matchesEmail;
    })
    .sort((a, b) => {
      const aValue = a[sortField] || "";
      const bValue = b[sortField] || "";
      
      if (sortOrder === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Mail className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">No leads yet</h3>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          Start scraping to discover potential leads. Your results will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, job title, or company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 lg:h-10 pl-9 bg-background/50 border-border/50 focus:border-primary/50 transition-colors text-sm"
          />
        </div>
        
        <div className="flex gap-2 flex-wrap sm:flex-nowrap shrink-0">
          <Select value={experienceFilter} onValueChange={setExperienceFilter}>
            <SelectTrigger className="h-9 lg:h-10 w-full sm:w-[140px] bg-background/50 border-border/50 text-sm">
              <SelectValue placeholder="Experience" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border z-50">
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="entry">Entry Level</SelectItem>
              <SelectItem value="mid">Mid Level</SelectItem>
              <SelectItem value="senior">Senior Level</SelectItem>
              <SelectItem value="lead">Lead/Principal</SelectItem>
            </SelectContent>
          </Select>

          <Button
            onClick={() => setShowEmailOnly(!showEmailOnly)}
            variant={showEmailOnly ? "default" : "outline"}
            size="sm"
            className="h-9 lg:h-10 gap-1.5 whitespace-nowrap text-xs lg:text-sm transition-all duration-200"
          >
            <Mail className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{showEmailOnly ? "Email Only" : "All"}</span>
          </Button>
          
          <Button
            onClick={onDownloadCSV}
            variant="outline"
            size="sm"
            className="h-9 lg:h-10 gap-1.5 whitespace-nowrap text-xs lg:text-sm hover:bg-primary/5 hover:border-primary/30 transition-all duration-200"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Table with responsive scroll */}
      <div className="rounded-lg border border-border/50 bg-background/30 overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent bg-muted/20 border-b border-border/30">
                <TableHead className="h-10 lg:h-11 w-[180px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("candidate_name")}
                    className="gap-1 h-7 px-1.5 -ml-1.5 hover:bg-muted/50 font-medium text-xs"
                  >
                    Name
                    <ArrowUpDown className="w-3 h-3" />
                  </Button>
                </TableHead>
                <TableHead className="h-10 lg:h-11 w-[160px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("job_title")}
                    className="gap-1 h-7 px-1.5 -ml-1.5 hover:bg-muted/50 font-medium text-xs"
                  >
                    Job Title
                    <ArrowUpDown className="w-3 h-3" />
                  </Button>
                </TableHead>
                <TableHead className="h-10 lg:h-11 w-[140px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("company")}
                    className="gap-1 h-7 px-1.5 -ml-1.5 hover:bg-muted/50 font-medium text-xs"
                  >
                    Company
                    <ArrowUpDown className="w-3 h-3" />
                  </Button>
                </TableHead>
                <TableHead className="h-10 lg:h-11 hidden lg:table-cell w-[120px] text-xs font-medium">Location</TableHead>
                <TableHead className="h-10 lg:h-11 hidden md:table-cell w-[160px] text-xs font-medium">Email</TableHead>
                <TableHead className="h-10 lg:h-11 hidden xl:table-cell w-[100px] text-xs font-medium">Experience</TableHead>
                <TableHead className="h-10 lg:h-11 text-right w-[140px] text-xs font-medium">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedLeads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="hover:bg-muted/20 transition-colors border-b border-border/20 last:border-0"
                >
                  <TableCell className="font-medium py-2.5 lg:py-3 text-sm">
                    <span className="truncate block max-w-[160px]" title={lead.candidate_name}>
                      {lead.candidate_name}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 lg:py-3 text-sm text-muted-foreground">
                    <span className="truncate block max-w-[140px]" title={lead.job_title || ""}>
                      {lead.job_title || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 lg:py-3 text-sm text-muted-foreground">
                    <span className="truncate block max-w-[120px]" title={lead.company || ""}>
                      {lead.company || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 lg:py-3 text-sm text-muted-foreground hidden lg:table-cell">
                    <span className="truncate block max-w-[100px]" title={lead.location || ""}>
                      {lead.location || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 lg:py-3 text-sm text-muted-foreground hidden md:table-cell">
                    <span className="truncate block max-w-[140px]" title={lead.contact_email || ""}>
                      {lead.contact_email || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 lg:py-3 hidden xl:table-cell">
                    {lead.experience_level ? (
                      <Badge variant="secondary" className="capitalize text-[10px] lg:text-xs">
                        {lead.experience_level}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5 lg:py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRunDeepSearch(lead)}
                        disabled={runningDeepSearch.has(lead.id)}
                        className="h-7 lg:h-8 gap-1 text-[10px] lg:text-xs px-2 lg:px-2.5 hover:bg-primary/5 hover:border-primary/30 transition-all duration-200"
                      >
                        <Brain className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
                        <span className="hidden xl:inline">{runningDeepSearch.has(lead.id) ? "Running..." : "Deep Search"}</span>
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 lg:h-8 w-7 lg:w-8 p-0 hover:bg-muted transition-colors"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {lead.linkedin_url && (
                            <DropdownMenuItem asChild>
                              <a
                                href={lead.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <ExternalLink className="w-4 h-4" />
                                View LinkedIn Profile
                              </a>
                            </DropdownMenuItem>
                          )}
                          {lead.contact_email && (
                            <DropdownMenuItem asChild>
                              <a
                                href={`mailto:${lead.contact_email}`}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <Mail className="w-4 h-4" />
                                Send Email
                              </a>
                            </DropdownMenuItem>
                          )}
                          {(lead.linkedin_url || lead.contact_email) && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            onClick={() => setLeadToDelete({ id: lead.id, name: lead.candidate_name })}
                            className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                            disabled={deletingLead === lead.id}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete Lead
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <p className="text-xs lg:text-sm text-muted-foreground text-center py-2">
        Showing {filteredAndSortedLeads.length} of {leads.length} leads
      </p>

      {/* Deep Search Results Dialog */}
      <Dialog open={!!selectedCandidateId} onOpenChange={(open) => !open && setSelectedCandidateId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Deep Search Results
            </DialogTitle>
          </DialogHeader>
          {selectedCandidateId && (
            <DeepSearchResults candidateId={selectedCandidateId} />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Lead Confirmation Dialog */}
      <AlertDialog open={!!leadToDelete} onOpenChange={(open) => !open && setLeadToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {leadToDelete?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (leadToDelete) {
                  handleDeleteLead(leadToDelete.id, leadToDelete.name);
                  setLeadToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};