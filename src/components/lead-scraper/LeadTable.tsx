import { useState } from "react";
import { ArrowUpDown, Download, ExternalLink, Mail, Brain, Trash2, Search } from "lucide-react";
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
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, job title, or company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-10 pl-9 bg-background border-border"
          />
        </div>
        
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <Select value={experienceFilter} onValueChange={setExperienceFilter}>
            <SelectTrigger className="h-10 w-full sm:w-[160px] bg-background border-border">
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
            className="h-10 gap-2 whitespace-nowrap"
          >
            <Mail className="w-4 h-4" />
            <span className="hidden sm:inline">{showEmailOnly ? "Email Only" : "All"}</span>
          </Button>
          
          <Button
            onClick={onDownloadCSV}
            variant="outline"
            size="sm"
            className="h-10 gap-2 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Table with horizontal scroll */}
      <div className="rounded-lg border border-border overflow-x-auto">
        <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="h-11">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort("candidate_name")}
                  className="gap-1 h-8 px-2 -ml-2 hover:bg-transparent font-medium"
                >
                  Name
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </TableHead>
              <TableHead className="h-11">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort("job_title")}
                  className="gap-1 h-8 px-2 -ml-2 hover:bg-transparent font-medium"
                >
                  Job Title
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </TableHead>
              <TableHead className="h-11">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort("company")}
                  className="gap-1 h-8 px-2 -ml-2 hover:bg-transparent font-medium"
                >
                  Company
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </TableHead>
              <TableHead className="h-11 hidden lg:table-cell">Location</TableHead>
              <TableHead className="h-11 hidden md:table-cell">Email</TableHead>
              <TableHead className="h-11 hidden xl:table-cell">Experience</TableHead>
              <TableHead className="h-11 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedLeads.map((lead) => (
              <TableRow
                key={lead.id}
                className="hover:bg-muted/30 transition-colors"
              >
                <TableCell className="font-medium py-3">{lead.candidate_name}</TableCell>
                <TableCell className="py-3">{lead.job_title || "—"}</TableCell>
                <TableCell className="py-3">{lead.company || "—"}</TableCell>
                <TableCell className="py-3 text-muted-foreground hidden lg:table-cell">{lead.location || "—"}</TableCell>
                <TableCell className="py-3 text-muted-foreground hidden md:table-cell">{lead.contact_email || "—"}</TableCell>
                <TableCell className="py-3 hidden xl:table-cell">
                  {lead.experience_level ? (
                    <Badge variant="secondary" className="capitalize text-xs">
                      {lead.experience_level}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRunDeepSearch(lead)}
                      disabled={runningDeepSearch.has(lead.id)}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Brain className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{runningDeepSearch.has(lead.id) ? "Running..." : "Deep Search"}</span>
                    </Button>
                    {lead.linkedin_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        className="h-8 w-8 p-0"
                      >
                        <a
                          href={lead.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 hover:text-destructive hover:bg-destructive/10"
                          disabled={deletingLead === lead.id}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Lead</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete {lead.candidate_name}? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteLead(lead.id, lead.candidate_name)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground text-center">
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
    </div>
  );
};