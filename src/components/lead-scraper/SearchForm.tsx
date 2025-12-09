import { useState } from "react";
import { Search, Building2, Briefcase, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
    <div className="space-y-3">
      <Label className="text-sm font-medium flex items-center gap-2">
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
          className="flex-1"
        />
        <Button 
          type="button" 
          onClick={() => handleAddItem(field, inputField)} 
          size="icon" 
          variant="secondary"
        >
          +
        </Button>
      </div>
      {Array.isArray(formData[field]) && (formData[field] as string[]).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(formData[field] as string[]).map((item) => (
            <Badge
              key={item}
              variant="secondary"
              className="px-3 py-1.5 cursor-pointer hover:bg-destructive/10 transition-colors"
              onClick={() => handleRemoveItem(field, item)}
            >
              {item} <X className="w-3 h-3 ml-1" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-cyan-500 bg-clip-text text-transparent">
          LinkedIn Search Filters
        </CardTitle>
      </CardHeader>
      
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Search Query */}
          <div className="space-y-3">
            <Label htmlFor="searchQuery" className="text-sm font-medium flex items-center gap-2">
              <Search className="w-4 h-4" />
              Search Query
            </Label>
            <Input
              id="searchQuery"
              placeholder="Enter search keywords..."
              value={formData.searchQuery}
              onChange={(e) => setFormData({ ...formData, searchQuery: e.target.value })}
              className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Max Items */}
          <div className="space-y-3">
            <Label htmlFor="maxItems" className="text-sm font-medium">
              Maximum Results: {formData.maxItems}
            </Label>
            <input
              type="range"
              id="maxItems"
              min="10"
              max="500"
              step="10"
              value={formData.maxItems}
              onChange={(e) => setFormData({ ...formData, maxItems: parseInt(e.target.value) })}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10</span>
              <span>500</span>
            </div>
          </div>

          {/* Current Companies */}
          {renderArrayInput(
            "Current Companies",
            "currentCompanies",
            "currentCompany",
            "e.g. Google, Microsoft",
            <Building2 className="w-4 h-4" />
          )}

          {/* Current Job Titles */}
          {renderArrayInput(
            "Current Job Titles",
            "currentJobTitles",
            "currentJobTitle",
            "e.g. Software Engineer",
            <Briefcase className="w-4 h-4" />
          )}

          {/* Locations */}
          {renderArrayInput(
            "Locations",
            "locations",
            "location",
            "e.g. San Francisco, CA",
            <MapPin className="w-4 h-4" />
          )}

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
