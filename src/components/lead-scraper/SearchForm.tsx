import { useState } from "react";
import { Search, Building2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { LocationMultiSelect } from "./LocationMultiSelect";
import { JobTitleMultiSelect } from "./JobTitleMultiSelect";

export interface SearchFormData {
  currentCompanies: string[];
  currentJobTitles: string[];
  locations: string[];
  maxItems: number;
  searchQuery: string;
}

interface SearchFormProps {
  onSubmit: (data: SearchFormData) => void;
  isLoading: boolean;
}

export const SearchForm = ({ onSubmit, isLoading }: SearchFormProps) => {
  const [formData, setFormData] = useState<SearchFormData>({
    currentCompanies: [],
    currentJobTitles: [],
    locations: [],
    maxItems: 50,
    searchQuery: "",
  });
  
  const [companyInput, setCompanyInput] = useState("");

  const handleAddCompany = () => {
    const value = companyInput.trim();
    if (value && !formData.currentCompanies.includes(value)) {
      setFormData({
        ...formData,
        currentCompanies: [...formData.currentCompanies, value],
      });
      setCompanyInput("");
    }
  };

  const handleRemoveCompany = (company: string) => {
    setFormData({
      ...formData,
      currentCompanies: formData.currentCompanies.filter((c) => c !== company),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Include any pending company input
    const finalCompanies = companyInput.trim() && !formData.currentCompanies.includes(companyInput.trim())
      ? [...formData.currentCompanies, companyInput.trim()]
      : formData.currentCompanies;

    const finalData: SearchFormData = {
      ...formData,
      currentCompanies: finalCompanies,
    };

    console.log('Form data being submitted:', finalData);
    onSubmit(finalData);
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-200 overflow-hidden">
      <div className="p-4 lg:p-6 border-b border-border/30">
        <h2 className="text-lg lg:text-xl font-semibold text-foreground">
          Search Filters
        </h2>
      </div>
      
      <form onSubmit={handleSubmit} className="p-4 lg:p-6 space-y-5 lg:space-y-6">
        {/* Search Query & Max Items Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          {/* Search Query */}
          <div className="space-y-2">
            <Label htmlFor="searchQuery" className="text-xs lg:text-sm font-medium text-foreground flex items-center gap-2">
              <Search className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-muted-foreground" />
              Search Query
            </Label>
            <Input
              id="searchQuery"
              placeholder="Enter search keywords..."
              value={formData.searchQuery}
              onChange={(e) => setFormData({ ...formData, searchQuery: e.target.value })}
              className="h-9 lg:h-10 bg-background/50 border-border/50 focus:border-primary/50 text-sm transition-colors"
            />
          </div>

          {/* Max Items Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="maxItems" className="text-xs lg:text-sm font-medium text-foreground">
                Maximum Results
              </Label>
              <span className="text-xs lg:text-sm font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-md tabular-nums">
                {formData.maxItems}
              </span>
            </div>
            <Slider
              id="maxItems"
              min={10}
              max={500}
              step={10}
              value={[formData.maxItems]}
              onValueChange={(value) => setFormData({ ...formData, maxItems: value[0] })}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] lg:text-xs text-muted-foreground">
              <span>10</span>
              <span>500</span>
            </div>
          </div>
        </div>

        {/* Filter Fields Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          {/* Companies - keep simple input */}
          <div className="space-y-2">
            <Label className="text-xs lg:text-sm font-medium text-foreground flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-muted-foreground" />
              Companies
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Google, Microsoft"
                value={companyInput}
                onChange={(e) => setCompanyInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCompany();
                  }
                }}
                className="h-9 lg:h-10 flex-1 bg-background/50 border-border/50 focus:border-primary/50 text-sm transition-colors"
              />
              <Button 
                type="button" 
                onClick={handleAddCompany} 
                size="icon"
                variant="secondary"
                className="h-9 lg:h-10 w-9 lg:w-10 shrink-0 hover:bg-primary/10 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {formData.currentCompanies.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {formData.currentCompanies.map((company) => (
                  <Badge
                    key={company}
                    variant="secondary"
                    className="px-2 py-1 text-xs cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors group max-w-[150px]"
                    onClick={() => handleRemoveCompany(company)}
                  >
                    <span className="truncate">{company}</span>
                    <X className="w-2.5 h-2.5 ml-1 opacity-60 group-hover:opacity-100 shrink-0" />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Job Titles - Smart Multi-Select */}
          <JobTitleMultiSelect
            value={formData.currentJobTitles}
            onChange={(titles) => setFormData({ ...formData, currentJobTitles: titles })}
          />

          {/* Locations - Smart Multi-Select */}
          <LocationMultiSelect
            value={formData.locations}
            onChange={(locations) => setFormData({ ...formData, locations })}
          />
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-10 lg:h-11 text-sm lg:text-base font-medium bg-primary hover:bg-primary/90 shadow-sm hover:shadow-md transition-all duration-200"
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              <span>Scraping...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 lg:w-5 lg:h-5" />
              <span>Start Scraping</span>
            </div>
          )}
        </Button>
      </form>
    </div>
  );
};
