import { useState } from "react";
import { Search, Building2, Briefcase, GraduationCap, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

export interface SearchFormData {
  currentCompanies: string[];
  currentJobTitles: string[];
  functionIds: string[];
  locations: string[];
  maxItems: number;
  pastCompanies: string[];
  pastJobTitles: string[];
  recentlyChangedJobs: boolean;
  schools: string[];
  searchQuery: string;
  seniorityLevelIds: string[];
  yearsAtCurrentCompanyIds: string[];
  yearsOfExperienceIds: string[];
}

interface SearchFormProps {
  onSubmit: (data: SearchFormData) => void;
  isLoading: boolean;
}

export const SearchForm = ({ onSubmit, isLoading }: SearchFormProps) => {
  const [formData, setFormData] = useState<SearchFormData>({
    currentCompanies: [],
    currentJobTitles: [],
    functionIds: [],
    locations: [],
    maxItems: 50,
    pastCompanies: [],
    pastJobTitles: [],
    recentlyChangedJobs: false,
    schools: [],
    searchQuery: "",
    seniorityLevelIds: [],
    yearsAtCurrentCompanyIds: [],
    yearsOfExperienceIds: [],
  });
  
  const [inputs, setInputs] = useState({
    currentCompany: "",
    currentJobTitle: "",
    functionId: "",
    location: "",
    pastCompany: "",
    pastJobTitle: "",
    school: "",
    seniorityLevel: "",
    yearsAtCompany: "",
    yearsOfExperience: "",
  });

  const handleAddItem = (field: keyof SearchFormData, inputField: keyof typeof inputs) => {
    const value = inputs[inputField].trim();
    const currentArray = formData[field] as string[];
    if (value && Array.isArray(currentArray) && !currentArray.includes(value)) {
      const updatedFormData = {
        ...formData,
        [field]: [...currentArray, value],
      };
      console.log(`Added "${value}" to ${field}:`, updatedFormData[field]);
      setFormData(updatedFormData);
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
    console.log('Form data being submitted:', formData);
    console.log('Non-empty fields:', Object.entries(formData).filter(([key, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'string') return value.trim() !== '';
      if (typeof value === 'boolean') return value;
      return value > 0;
    }));
    onSubmit(formData);
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
      {Array.isArray(formData[field]) && formData[field].length > 0 && (
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
          {/* Basic Search */}
          <div className="space-y-4">
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
          </div>

          <Separator />

          {/* Advanced Filters */}
          <Tabs defaultValue="location" className="w-full">
            <TabsList className="grid w-full grid-cols-4 lg:grid-cols-5">
              <TabsTrigger value="location" className="text-xs">Location</TabsTrigger>
              <TabsTrigger value="job" className="text-xs">Job</TabsTrigger>
              <TabsTrigger value="company" className="text-xs">Company</TabsTrigger>
              <TabsTrigger value="experience" className="text-xs">Experience</TabsTrigger>
              <TabsTrigger value="education" className="text-xs">Education</TabsTrigger>
            </TabsList>

            <TabsContent value="location" className="space-y-4 mt-4">
              {renderArrayInput(
                "Locations",
                "locations",
                "location",
                "e.g. San Francisco, CA",
                <Search className="w-4 h-4" />
              )}
            </TabsContent>

            <TabsContent value="job" className="space-y-4 mt-4">
              {renderArrayInput(
                "Current Job Titles",
                "currentJobTitles",
                "currentJobTitle",
                "e.g. Software Engineer",
                <Briefcase className="w-4 h-4" />
              )}
              
              {renderArrayInput(
                "Past Job Titles",
                "pastJobTitles",
                "pastJobTitle",
                "e.g. Junior Developer",
                <Briefcase className="w-4 h-4" />
              )}
              
              {renderArrayInput(
                "Function IDs",
                "functionIds",
                "functionId",
                "e.g. Engineering, Sales",
                <Briefcase className="w-4 h-4" />
              )}
              
              {renderArrayInput(
                "Seniority Level IDs",
                "seniorityLevelIds",
                "seniorityLevel",
                "e.g. Entry, Mid, Senior",
                <Briefcase className="w-4 h-4" />
              )}
            </TabsContent>

            <TabsContent value="company" className="space-y-4 mt-4">
              {renderArrayInput(
                "Current Companies",
                "currentCompanies",
                "currentCompany",
                "e.g. Google, Microsoft",
                <Building2 className="w-4 h-4" />
              )}
              
              {renderArrayInput(
                "Past Companies",
                "pastCompanies",
                "pastCompany",
                "e.g. Apple, Amazon",
                <Building2 className="w-4 h-4" />
              )}
            </TabsContent>

            <TabsContent value="experience" className="space-y-4 mt-4">
              {renderArrayInput(
                "Years of Experience IDs",
                "yearsOfExperienceIds",
                "yearsOfExperience",
                "e.g. 1-3, 3-5, 5-10",
                <Clock className="w-4 h-4" />
              )}
              
              {renderArrayInput(
                "Years at Current Company IDs",
                "yearsAtCurrentCompanyIds",
                "yearsAtCompany",
                "e.g. 0-1, 1-2, 2-5",
                <Clock className="w-4 h-4" />
              )}

              <div className="flex items-center justify-between p-4 bg-accent/20 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="recentlyChangedJobs" className="text-sm font-medium">
                    Recently Changed Jobs
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Filter candidates who recently changed positions
                  </p>
                </div>
                <Switch
                  id="recentlyChangedJobs"
                  checked={formData.recentlyChangedJobs}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, recentlyChangedJobs: checked })
                  }
                />
              </div>
            </TabsContent>

            <TabsContent value="education" className="space-y-4 mt-4">
              {renderArrayInput(
                "Schools",
                "schools",
                "school",
                "e.g. Stanford, MIT",
                <GraduationCap className="w-4 h-4" />
              )}
            </TabsContent>
          </Tabs>

          <Separator />

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
