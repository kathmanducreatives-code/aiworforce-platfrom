import { useState } from "react";
import { Search, Building2, Briefcase, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";

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
  
  const [inputs, setInputs] = useState({
    currentCompany: "",
    currentJobTitle: "",
    location: "",
  });

  const handleAddItem = (field: keyof SearchFormData, inputField: keyof typeof inputs) => {
    const value = inputs[inputField].trim();
    const currentArray = formData[field] as string[];
    if (value && Array.isArray(currentArray) && !currentArray.includes(value)) {
      setFormData({
        ...formData,
        [field]: [...currentArray, value],
      });
      setInputs({ ...inputs, [inputField]: "" });
    }
  };

  const handleRemoveItem = (field: keyof SearchFormData, item: string) => {
    setFormData({
      ...formData,
      [field]: (formData[field] as string[]).filter(i => i !== item),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const buildArray = (field: keyof SearchFormData, inputKey: keyof typeof inputs) => {
      const current = (formData[field] as string[]) || [];
      const pending = inputs[inputKey].trim();
      if (pending && !current.includes(pending)) {
        return [...current, pending];
      }
      return current;
    };

    const finalData: SearchFormData = {
      ...formData,
      currentCompanies: buildArray("currentCompanies", "currentCompany"),
      currentJobTitles: buildArray("currentJobTitles", "currentJobTitle"),
      locations: buildArray("locations", "location"),
    };

    console.log('Form data being submitted:', finalData);
    onSubmit(finalData);
  };

  const renderArrayInput = (
    label: string,
    field: keyof SearchFormData,
    inputField: keyof typeof inputs,
    placeholder: string,
    icon: React.ReactNode
  ) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground flex items-center gap-2">
        {icon}
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={inputs[inputField]}
          onChange={(e) => setInputs({ ...inputs, [inputField]: e.target.value })}
          onKeyPress={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddItem(field, inputField);
            }
          }}
          className="h-11 flex-1 bg-background border-border focus:border-primary"
        />
        <Button 
          type="button" 
          onClick={() => handleAddItem(field, inputField)} 
          size="icon"
          variant="secondary"
          className="h-11 w-11 shrink-0"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {Array.isArray(formData[field]) && (formData[field] as string[]).length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {(formData[field] as string[]).map((item) => (
            <Badge
              key={item}
              variant="secondary"
              className="px-3 py-1.5 cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors group"
              onClick={() => handleRemoveItem(field, item)}
            >
              {item}
              <X className="w-3 h-3 ml-1.5 opacity-60 group-hover:opacity-100" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-foreground mb-6">
        Search Filters
      </h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Search Query */}
        <div className="space-y-2">
          <Label htmlFor="searchQuery" className="text-sm font-medium text-foreground flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            Search Query
          </Label>
          <Input
            id="searchQuery"
            placeholder="Enter search keywords..."
            value={formData.searchQuery}
            onChange={(e) => setFormData({ ...formData, searchQuery: e.target.value })}
            className="h-11 bg-background border-border focus:border-primary"
          />
        </div>

        {/* Max Items Slider */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="maxItems" className="text-sm font-medium text-foreground">
              Maximum Results
            </Label>
            <span className="text-sm font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-md">
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
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>10</span>
            <span>500</span>
          </div>
        </div>

        {/* Filter Fields Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Current Companies */}
          {renderArrayInput(
            "Companies",
            "currentCompanies",
            "currentCompany",
            "e.g. Google, Microsoft",
            <Building2 className="w-4 h-4 text-muted-foreground" />
          )}

          {/* Current Job Titles */}
          {renderArrayInput(
            "Job Titles",
            "currentJobTitles",
            "currentJobTitle",
            "e.g. Software Engineer",
            <Briefcase className="w-4 h-4 text-muted-foreground" />
          )}

          {/* Locations */}
          {renderArrayInput(
            "Locations",
            "locations",
            "location",
            "e.g. San Francisco, CA",
            <MapPin className="w-4 h-4 text-muted-foreground" />
          )}
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-12 text-base font-medium bg-primary hover:bg-primary/90 transition-colors"
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
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
    </div>
  );
};