import { useState } from "react";
import { Search, Sparkles, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

export interface SearchFormData {
  jobTitle: string;
  location: string;
  keywords: string[];
  experienceLevel: string;
  industry: string;
  numberOfLeads: number;
}

interface SearchFormProps {
  onSubmit: (data: SearchFormData) => void;
  isLoading: boolean;
}

export const SearchForm = ({ onSubmit, isLoading }: SearchFormProps) => {
  const [formData, setFormData] = useState<SearchFormData>({
    jobTitle: "",
    location: "",
    keywords: [],
    experienceLevel: "",
    industry: "",
    numberOfLeads: 50,
  });
  
  const [keywordInput, setKeywordInput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleAddKeyword = () => {
    if (keywordInput.trim() && !formData.keywords.includes(keywordInput.trim())) {
      setFormData({
        ...formData,
        keywords: [...formData.keywords, keywordInput.trim()],
      });
      setKeywordInput("");
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    setFormData({
      ...formData,
      keywords: formData.keywords.filter(k => k !== keyword),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const completionPercentage = Math.round(
    (Object.values(formData).filter(v => 
      Array.isArray(v) ? v.length > 0 : Boolean(v)
    ).length / 6) * 100
  );

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-cyan-500 bg-clip-text text-transparent">
            Search Criteria
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Progress</span>
            <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-primary to-cyan-500 transition-all duration-500"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
            <span className="text-sm font-medium">{completionPercentage}%</span>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="jobTitle" className="text-sm font-medium">
                Job Title *
              </Label>
              <Input
                id="jobTitle"
                placeholder="e.g. Software Engineer"
                value={formData.jobTitle}
                onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                required
                className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location" className="text-sm font-medium">
                Location *
              </Label>
              <Input
                id="location"
                placeholder="e.g. San Francisco, CA"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                required
                className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full flex items-center justify-between p-4 hover:bg-accent/50 rounded-lg transition-all"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Advanced Options
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            
            <CollapsibleContent className="space-y-6 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="experienceLevel" className="text-sm font-medium">
                    Experience Level
                  </Label>
                  <Select
                    value={formData.experienceLevel}
                    onValueChange={(value) => setFormData({ ...formData, experienceLevel: value })}
                  >
                    <SelectTrigger id="experienceLevel" className="bg-background">
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent className="bg-background border-border z-50">
                      <SelectItem value="entry">Entry Level</SelectItem>
                      <SelectItem value="mid">Mid Level</SelectItem>
                      <SelectItem value="senior">Senior Level</SelectItem>
                      <SelectItem value="lead">Lead/Principal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="industry" className="text-sm font-medium">
                    Industry
                  </Label>
                  <Input
                    id="industry"
                    placeholder="e.g. Technology, Finance"
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                    className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="keywords" className="text-sm font-medium">
                  Keywords
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="keywords"
                    placeholder="Add a keyword and press Enter"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddKeyword();
                      }
                    }}
                    className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                  />
                  <Button type="button" onClick={handleAddKeyword} size="icon" variant="secondary">
                    +
                  </Button>
                </div>
                {formData.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {formData.keywords.map((keyword) => (
                      <Badge
                        key={keyword}
                        variant="secondary"
                        className="px-3 py-1 cursor-pointer hover:bg-destructive/10 transition-colors"
                        onClick={() => handleRemoveKeyword(keyword)}
                      >
                        {keyword} ×
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="numberOfLeads" className="text-sm font-medium">
                  Number of Leads: {formData.numberOfLeads}
                </Label>
                <input
                  type="range"
                  id="numberOfLeads"
                  min="10"
                  max="500"
                  step="10"
                  value={formData.numberOfLeads}
                  onChange={(e) => setFormData({ ...formData, numberOfLeads: parseInt(e.target.value) })}
                  className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>10</span>
                  <span>500</span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90 transition-all duration-300 shadow-lg hover:shadow-primary/25"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Scraping...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                Start Scraping
              </div>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
