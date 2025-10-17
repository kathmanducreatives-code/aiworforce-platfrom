import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { leadScraperApi, type LeadScraperFormData } from "@/services/leadScraperApi";
import { Search, RefreshCw, ExternalLink, Loader2, Filter, ArrowUpDown, Download, ArrowLeft } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface LinkedInLead {
  id: string;
  candidate_name: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  linkedin_url: string | null;
  contact_email: string | null;
  experience_level: string | null;
  scraped_at: string;
}

export default function LeadScraper() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [leads, setLeads] = useState<LinkedInLead[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [experienceFilter, setExperienceFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<keyof LinkedInLead>("scraped_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [formData, setFormData] = useState<LeadScraperFormData>({
    jobTitle: "",
    location: "",
    keywords: [],
    experienceLevel: "",
    industry: "",
    numberOfLeads: 10,
  });

  // Fetch leads from Supabase
  const fetchLeads = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('linkedin_leads')
        .select('*')
        .order('scraped_at', { ascending: false });

      if (error) throw error;
      setLeads(data || []);
    } catch (error) {
      console.error('Error fetching leads:', error);
      toast({
        title: "Error",
        description: "Failed to fetch leads",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Set up realtime subscription
  useEffect(() => {
    fetchLeads();

    const channel = supabase
      .channel('linkedin-leads-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'linkedin_leads'
        },
        () => {
          console.log('Real-time update detected, refreshing leads...');
          fetchLeads();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.jobTitle || !formData.location) {
      toast({
        title: "Missing Information",
        description: "Please fill in job title and location",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await leadScraperApi.scrapeLeads(formData);
      
      toast({
        title: "Success",
        description: result.message || "Lead scraping initiated. Results will appear shortly.",
      });

      // Reset form
      setFormData({
        jobTitle: "",
        location: "",
        keywords: [],
        experienceLevel: "",
        industry: "",
        numberOfLeads: 10,
      });
    } catch (error) {
      console.error('Error submitting lead scraper request:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to initiate lead scraping",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeywordsChange = (value: string) => {
    const keywords = value.split(',').map(k => k.trim()).filter(k => k.length > 0);
    setFormData({ ...formData, keywords });
  };

  // Filter and sort leads
  const filteredAndSortedLeads = leads
    .filter(lead => {
      const matchesSearch = searchTerm === "" || 
        lead.candidate_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.job_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.location?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesExperience = experienceFilter === "all" || lead.experience_level === experienceFilter;

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

  const toggleSort = (field: keyof LinkedInLead) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const downloadCSV = () => {
    // Create CSV headers
    const headers = ['Name', 'Job Title', 'Company', 'Location', 'Experience Level', 'Email', 'LinkedIn URL', 'Scraped Date'];
    
    // Create CSV rows
    const rows = filteredAndSortedLeads.map(lead => [
      lead.candidate_name,
      lead.job_title || '',
      lead.company || '',
      lead.location || '',
      lead.experience_level || '',
      lead.contact_email || '',
      lead.linkedin_url || '',
      new Date(lead.scraped_at).toLocaleDateString()
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `linkedin_leads_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <Button 
            variant="ghost" 
            onClick={() => navigate(-1)}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-4xl font-bold mb-2">LinkedIn Lead Scraper</h1>
          <p className="text-muted-foreground">Extract candidate data from LinkedIn based on your search criteria</p>
        </div>

        {/* Search Form */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Search Criteria</CardTitle>
            <CardDescription>Enter the details to scrape LinkedIn leads</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">Job Title *</Label>
                  <Input
                    id="jobTitle"
                    placeholder="e.g., Software Engineer"
                    value={formData.jobTitle}
                    onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location *</Label>
                  <Input
                    id="location"
                    placeholder="e.g., San Francisco, CA"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="industry">Industry</Label>
                  <Input
                    id="industry"
                    placeholder="e.g., Technology, Healthcare"
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                  <Input
                    id="keywords"
                    placeholder="e.g., React, TypeScript, Node.js"
                    onChange={(e) => handleKeywordsChange(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="experienceLevel">Experience Level</Label>
                  <Select
                    value={formData.experienceLevel}
                    onValueChange={(value) => setFormData({ ...formData, experienceLevel: value })}
                  >
                    <SelectTrigger id="experienceLevel">
                      <SelectValue placeholder="Select experience level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entry">Entry Level</SelectItem>
                      <SelectItem value="mid">Mid Level</SelectItem>
                      <SelectItem value="senior">Senior Level</SelectItem>
                      <SelectItem value="lead">Lead/Principal</SelectItem>
                      <SelectItem value="executive">Executive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="numberOfLeads">Number of Leads</Label>
                  <Input
                    id="numberOfLeads"
                    type="number"
                    min="1"
                    max="100"
                    placeholder="e.g., 10"
                    value={formData.numberOfLeads}
                    onChange={(e) => setFormData({ ...formData, numberOfLeads: parseInt(e.target.value) || 10 })}
                  />
                </div>
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scraping...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Start Scraping
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <CardTitle>Scraped Leads ({filteredAndSortedLeads.length})</CardTitle>
                <CardDescription>All LinkedIn leads extracted from your searches</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadCSV}
                  disabled={filteredAndSortedLeads.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchLeads}
                  disabled={isLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 mt-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, title, company, or location..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="w-full md:w-48">
                <Select value={experienceFilter} onValueChange={setExperienceFilter}>
                  <SelectTrigger>
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter by experience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="entry">Entry Level</SelectItem>
                    <SelectItem value="mid">Mid Level</SelectItem>
                    <SelectItem value="senior">Senior Level</SelectItem>
                    <SelectItem value="lead">Lead/Principal</SelectItem>
                    <SelectItem value="executive">Executive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredAndSortedLeads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No leads found. Start scraping to see results here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleSort('candidate_name')}
                      >
                        <div className="flex items-center">
                          Name
                          <ArrowUpDown className="ml-2 h-4 w-4" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleSort('job_title')}
                      >
                        <div className="flex items-center">
                          Job Title
                          <ArrowUpDown className="ml-2 h-4 w-4" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleSort('company')}
                      >
                        <div className="flex items-center">
                          Company
                          <ArrowUpDown className="ml-2 h-4 w-4" />
                        </div>
                      </TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Experience</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>LinkedIn</TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleSort('scraped_at')}
                      >
                        <div className="flex items-center">
                          Scraped
                          <ArrowUpDown className="ml-2 h-4 w-4" />
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedLeads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium">{lead.candidate_name}</TableCell>
                        <TableCell>{lead.job_title || '-'}</TableCell>
                        <TableCell>{lead.company || '-'}</TableCell>
                        <TableCell>{lead.location || '-'}</TableCell>
                        <TableCell>
                          {lead.experience_level ? (
                            <Badge variant="secondary" className="capitalize">
                              {lead.experience_level}
                            </Badge>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {lead.contact_email ? (
                            <a 
                              href={`mailto:${lead.contact_email}`}
                              className="text-primary hover:underline"
                            >
                              {lead.contact_email}
                            </a>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {lead.linkedin_url ? (
                            <a
                              href={lead.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center text-primary hover:underline"
                            >
                              View
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </a>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(lead.scraped_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
