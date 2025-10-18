import { useState } from "react";
import { ArrowUpDown, Download, ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
}

interface LeadTableProps {
  leads: LinkedInLead[];
  isLoading: boolean;
  onDownloadCSV: () => void;
}

type SortField = "candidate_name" | "job_title" | "company" | "scraped_at";
type SortOrder = "asc" | "desc";

export const LeadTable = ({ leads, isLoading, onDownloadCSV }: LeadTableProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [experienceFilter, setExperienceFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("scraped_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

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

      return matchesSearch && matchesExperience;
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
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-24 h-24 bg-gradient-to-br from-primary/20 to-cyan-500/20 rounded-full flex items-center justify-center mb-4">
          <Mail className="w-12 h-12 text-primary" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No leads yet</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Start scraping to discover potential leads. Your results will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <Input
          placeholder="Search by name, job title, or company..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-md"
        />
        
        <div className="flex gap-2 items-center">
          <Select value={experienceFilter} onValueChange={setExperienceFilter}>
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Experience Level" />
            </SelectTrigger>
            <SelectContent className="bg-background border-border z-50">
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="entry">Entry Level</SelectItem>
              <SelectItem value="mid">Mid Level</SelectItem>
              <SelectItem value="senior">Senior Level</SelectItem>
              <SelectItem value="lead">Lead/Principal</SelectItem>
            </SelectContent>
          </Select>
          
          <Button
            onClick={onDownloadCSV}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 overflow-hidden bg-card/50 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/50">
              <TableHead>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort("candidate_name")}
                  className="gap-1 hover:bg-accent/50"
                >
                  Name
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort("job_title")}
                  className="gap-1 hover:bg-accent/50"
                >
                  Job Title
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort("company")}
                  className="gap-1 hover:bg-accent/50"
                >
                  Company
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Experience</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedLeads.map((lead, index) => (
              <TableRow
                key={lead.id}
                className="hover:bg-accent/30 transition-all duration-200 border-border/50 animate-fade-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <TableCell className="font-medium">{lead.candidate_name}</TableCell>
                <TableCell>{lead.job_title || "—"}</TableCell>
                <TableCell>{lead.company || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{lead.location || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{lead.contact_email || "—"}</TableCell>
                <TableCell>
                  {lead.experience_level ? (
                    <Badge variant="secondary" className="capitalize">
                      {lead.experience_level}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {lead.linkedin_url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="gap-1 hover:text-primary"
                    >
                      <a
                        href={lead.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View
                      </a>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-muted-foreground text-center py-2">
        Showing {filteredAndSortedLeads.length} of {leads.length} leads
      </div>
    </div>
  );
};
