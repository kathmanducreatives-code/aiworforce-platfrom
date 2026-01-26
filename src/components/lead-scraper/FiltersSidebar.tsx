import { useState } from "react";
import { ChevronDown, ChevronRight, MapPin, Briefcase, Building2, Hash, SlidersHorizontal, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LocationMultiSelect } from "./LocationMultiSelect";
import { JobTitleMultiSelect } from "./JobTitleMultiSelect";
import { IndustryMultiSelect } from "./IndustryMultiSelect";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

export interface FilterState {
  skipOwned: boolean;
  jobTitles: string[];
  industries: string[];
  locations: string[];
  companies: string[];
  keywords: string[];
  maxResults: number;
}

interface FiltersSidebarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onApplyFilters: () => void;
  isLoading?: boolean;
}

interface FilterSectionProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const FilterSection = ({ title, icon, count, defaultOpen = false, children }: FilterSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between h-10 px-3 hover:bg-muted/50 group"
        >
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">
              {icon}
            </span>
            <span className="text-sm font-medium">{title}</span>
            {count !== undefined && count > 0 && (
              <Badge variant="secondary" className="text-xs h-5 px-1.5">
                {count}
              </Badge>
            )}
          </div>
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

export const FiltersSidebar = ({
  filters,
  onFiltersChange,
  onApplyFilters,
  isLoading = false,
}: FiltersSidebarProps) => {
  const [companyInput, setCompanyInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");

  const updateFilters = (updates: Partial<FilterState>) => {
    onFiltersChange({ ...filters, ...updates });
  };

  const handleAddCompany = () => {
    const value = companyInput.trim();
    if (value && !filters.companies.includes(value)) {
      updateFilters({ companies: [...filters.companies, value] });
      setCompanyInput("");
    }
  };

  const handleRemoveCompany = (company: string) => {
    updateFilters({ companies: filters.companies.filter((c) => c !== company) });
  };

  const handleAddKeyword = () => {
    const value = keywordInput.trim();
    if (value && !filters.keywords.includes(value)) {
      updateFilters({ keywords: [...filters.keywords, value] });
      setKeywordInput("");
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    updateFilters({ keywords: filters.keywords.filter((k) => k !== keyword) });
  };

  const activeFilterCount =
    filters.jobTitles.length +
    filters.industries.length +
    filters.locations.length +
    filters.companies.length +
    filters.keywords.length;

  return (
    <div className="h-full flex flex-col rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Filter className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Filters</h2>
        </div>
        {activeFilterCount > 0 && (
          <Badge variant="default" className="text-xs">
            {activeFilterCount} active
          </Badge>
        )}
      </div>

      {/* Skip Already Owned Toggle */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <span className="text-sm text-foreground">Skip already owned</span>
        <Switch
          checked={filters.skipOwned}
          onCheckedChange={(checked) => updateFilters({ skipOwned: checked })}
        />
      </div>

      {/* Filter Sections */}
      <ScrollArea className="flex-1 px-1">
        <div className="py-2 space-y-1">
          {/* Job Titles */}
          <FilterSection
            title="Job Titles"
            icon={<Briefcase className="w-4 h-4" />}
            count={filters.jobTitles.length}
            defaultOpen={true}
          >
            <JobTitleMultiSelect
              value={filters.jobTitles}
              onChange={(titles) => updateFilters({ jobTitles: titles })}
              placeholder="Search job titles..."
            />
          </FilterSection>

          {/* Industries */}
          <FilterSection
            title="Industries"
            icon={<Building2 className="w-4 h-4" />}
            count={filters.industries.length}
            defaultOpen={true}
          >
            <IndustryMultiSelect
              value={filters.industries}
              onChange={(industries) => updateFilters({ industries })}
              placeholder="Select industries..."
            />
          </FilterSection>

          {/* Location */}
          <FilterSection
            title="Location"
            icon={<MapPin className="w-4 h-4" />}
            count={filters.locations.length}
            defaultOpen={true}
          >
            <LocationMultiSelect
              value={filters.locations}
              onChange={(locations) => updateFilters({ locations })}
              placeholder="Search countries or cities..."
            />
            <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
              Select specific cities or broader regions to adjust result volume.
            </p>
          </FilterSection>

          {/* Companies */}
          <FilterSection
            title="Companies"
            icon={<Building2 className="w-4 h-4" />}
            count={filters.companies.length}
          >
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={companyInput}
                  onChange={(e) => setCompanyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCompany()}
                  placeholder="e.g. Google"
                  className="h-9 text-xs bg-background/50 border-muted-foreground/20 focus-visible:ring-primary/20 transition-all"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddCompany}
                  disabled={!companyInput.trim()}
                  className="h-9 px-3"
                >
                  Add
                </Button>
              </div>
              {filters.companies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {filters.companies.map((company) => (
                    <Badge
                      key={company}
                      variant="secondary"
                      className="px-2 py-0.5 text-xs flex items-center gap-1"
                    >
                      {company}
                      <X
                        className="w-3 h-3 cursor-pointer hover:text-destructive"
                        onClick={() => handleRemoveCompany(company)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </FilterSection>

          {/* Keywords */}
          <FilterSection
            title="Keywords"
            icon={<Hash className="w-4 h-4" />}
            count={filters.keywords.length}
          >
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddKeyword()}
                  placeholder="e.g. React, Python"
                  className="h-9 text-xs bg-background/50 border-muted-foreground/20 focus-visible:ring-primary/20 transition-all"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddKeyword}
                  disabled={!keywordInput.trim()}
                  className="h-9 px-3"
                >
                  Add
                </Button>
              </div>
              {filters.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {filters.keywords.map((keyword) => (
                    <Badge
                      key={keyword}
                      variant="secondary"
                      className="px-2 py-0.5 text-xs flex items-center gap-1"
                    >
                      {keyword}
                      <X
                        className="w-3 h-3 cursor-pointer hover:text-destructive"
                        onClick={() => handleRemoveKeyword(keyword)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </FilterSection>

          {/* Max Results */}
          <FilterSection
            title="Max Results"
            icon={<SlidersHorizontal className="w-4 h-4" />}
          >
            <div className="space-y-4 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{filters.maxResults} leads</span>
              </div>
              <Slider
                value={[filters.maxResults]}
                min={10}
                max={100}
                step={10}
                onValueChange={(value) => updateFilters({ maxResults: value[0] })}
                className="w-full"
              />
            </div>
          </FilterSection>
        </div>
      </ScrollArea>

      {/* Apply Button */}
      <div className="p-4 border-t border-border/30 bg-card/50">
        <Button
          className="w-full gap-2 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all duration-300"
          onClick={onApplyFilters}
          disabled={isLoading}
        >
          {isLoading ? "Searching..." : "Apply Filters"}
        </Button>
      </div>
    </div>

  );
};
// End of component
