import * as React from "react";
import { Check, ChevronsUpDown, Briefcase, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";

// Categorized job titles
const JOB_TITLES_BY_CATEGORY: Record<string, string[]> = {
  Engineering: [
    "Software Engineer",
    "Senior Software Engineer",
    "Staff Engineer",
    "Principal Engineer",
    "Frontend Developer",
    "Backend Developer",
    "Full Stack Developer",
    "DevOps Engineer",
    "Site Reliability Engineer",
    "Data Engineer",
    "Machine Learning Engineer",
    "AI Engineer",
    "Platform Engineer",
    "Cloud Engineer",
    "Infrastructure Engineer",
    "QA Engineer",
    "Test Engineer",
    "Security Engineer",
    "Mobile Developer",
    "iOS Developer",
    "Android Developer",
    "Embedded Systems Engineer",
    "Solutions Architect",
    "Technical Architect",
  ],
  "Product & Design": [
    "Product Manager",
    "Senior Product Manager",
    "Product Owner",
    "Technical Product Manager",
    "Group Product Manager",
    "Director of Product",
    "VP of Product",
    "UX Designer",
    "UI Designer",
    "Product Designer",
    "UX Researcher",
    "Design Lead",
    "Creative Director",
    "Graphic Designer",
  ],
  "Data & Analytics": [
    "Data Scientist",
    "Data Analyst",
    "Business Analyst",
    "Business Intelligence Analyst",
    "Analytics Engineer",
    "Quantitative Analyst",
    "Research Scientist",
  ],
  Leadership: [
    "CEO",
    "CTO",
    "CFO",
    "COO",
    "CIO",
    "CPO",
    "VP of Engineering",
    "Engineering Manager",
    "Director of Engineering",
    "Technical Lead",
    "Team Lead",
    "Head of Engineering",
  ],
  "Marketing & Sales": [
    "Marketing Manager",
    "Digital Marketing Manager",
    "Growth Manager",
    "Content Marketing Manager",
    "SEO Specialist",
    "Social Media Manager",
    "Brand Manager",
    "Sales Manager",
    "Account Executive",
    "Business Development Manager",
    "Sales Director",
    "Account Manager",
    "Customer Success Manager",
  ],
  Operations: [
    "Operations Manager",
    "Project Manager",
    "Program Manager",
    "Scrum Master",
    "Agile Coach",
    "Office Manager",
    "Executive Assistant",
  ],
  "HR & Finance": [
    "HR Manager",
    "Recruiter",
    "Technical Recruiter",
    "Talent Acquisition",
    "People Operations",
    "Finance Manager",
    "Controller",
    "Accountant",
    "Financial Analyst",
  ],
};

// Flatten for search
const ALL_JOB_TITLES = Object.values(JOB_TITLES_BY_CATEGORY).flat();

interface JobTitleMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export const JobTitleMultiSelect = ({
  value,
  onChange,
  placeholder = "Type or paste job titles...",
}: JobTitleMultiSelectProps) => {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const handleSelect = (title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    if (value.includes(trimmedTitle)) {
      onChange(value.filter((v) => v !== trimmedTitle));
    } else {
      onChange([...value, trimmedTitle]);
    }
  };

  const handleRemove = (title: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(value.filter((v) => v !== title));
  };

  // Handle comma-separated input and Enter key
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && search.trim()) {
      e.preventDefault();

      // Check if input contains commas - auto-split
      if (search.includes(",")) {
        const titles = search
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t && !value.includes(t));

        if (titles.length > 0) {
          onChange([...value, ...titles]);
        }
      } else {
        // Single title
        const trimmedSearch = search.trim();
        if (trimmedSearch && !value.includes(trimmedSearch)) {
          onChange([...value, trimmedSearch]);
        }
      }
      setSearch("");
    }
  };

  // Filter suggestions based on search
  const filteredCategories = Object.entries(JOB_TITLES_BY_CATEGORY)
    .map(([category, titles]) => ({
      category,
      titles: titles.filter(
        (title) =>
          title.toLowerCase().includes(search.toLowerCase()) &&
          !value.includes(title)
      ),
    }))
    .filter(({ titles }) => titles.length > 0);

  // Check if search matches any existing title
  const exactMatch = ALL_JOB_TITLES.find(
    (t) => t.toLowerCase() === search.toLowerCase()
  );
  const showCustomOption =
    search.trim() &&
    !exactMatch &&
    !value.includes(search.trim()) &&
    !search.includes(",");

  return (
    <div className="space-y-2">
      <Label className="text-xs lg:text-sm font-medium text-foreground flex items-center gap-1.5">
        <Briefcase className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-muted-foreground" />
        Job Titles
      </Label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select job titles"
            className={cn(
              "w-full h-9 lg:h-10 justify-between bg-background/50 border-border/50 hover:bg-background/80 hover:border-primary/30 transition-colors text-sm font-normal",
              !value.length && "text-muted-foreground"
            )}
          >
            <span className="truncate">
              {value.length > 0
                ? `${value.length} title${value.length > 1 ? "s" : ""} selected`
                : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0 bg-popover border-border/50 shadow-lg"
          align="start"
          sideOffset={4}
        >
          <Command className="bg-transparent" shouldFilter={false}>
            <CommandInput
              placeholder="Type titles or paste comma-separated..."
              value={search}
              onValueChange={setSearch}
              onKeyDown={handleInputKeyDown}
              className="h-9 text-sm"
            />
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground border-b border-border/30">
              💡 Tip: Paste comma-separated titles and press Enter
            </div>
            <CommandList className="max-h-[280px] overflow-y-auto">
              <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
                {search.includes(",") ? (
                  <span>Press Enter to add multiple titles</span>
                ) : (
                  <span>No matching titles. Press Enter to add custom.</span>
                )}
              </CommandEmpty>

              {/* Custom option for non-matching search */}
              {showCustomOption && (
                <CommandGroup heading="Custom">
                  <CommandItem
                    value={`custom-${search}`}
                    onSelect={() => {
                      handleSelect(search.trim());
                      setSearch("");
                    }}
                    className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                  >
                    <div className="h-4 w-4 border border-dashed border-primary/50 rounded-sm shrink-0 flex items-center justify-center">
                      <span className="text-[10px] text-primary">+</span>
                    </div>
                    <span className="flex-1 truncate">Add "{search.trim()}"</span>
                  </CommandItem>
                </CommandGroup>
              )}

              {/* Selected items at top */}
              {value.length > 0 && !search && (
                <CommandGroup heading="Selected">
                  {value.map((title) => (
                    <CommandItem
                      key={`selected-${title}`}
                      value={`selected-${title}`}
                      onSelect={() => handleSelect(title)}
                      className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                    >
                      <Check className="h-4 w-4 text-primary shrink-0" />
                      <span className="flex-1 truncate">{title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Categorized suggestions */}
              {filteredCategories.map(({ category, titles }) => (
                <CommandGroup key={category} heading={category}>
                  {titles.slice(0, 8).map((title) => (
                    <CommandItem
                      key={title}
                      value={title}
                      onSelect={() => handleSelect(title)}
                      className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                    >
                      <div className="h-4 w-4 border border-border/50 rounded-sm shrink-0" />
                      <span className="flex-1 truncate">{title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected badges */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.map((title) => (
            <Badge
              key={title}
              variant="secondary"
              className="px-2 py-1 text-xs cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors group max-w-[180px] bg-primary/10 text-primary border-primary/20"
            >
              <span className="truncate">{title}</span>
              <X
                className="w-2.5 h-2.5 ml-1 opacity-60 group-hover:opacity-100 shrink-0"
                onClick={(e) => handleRemove(title, e)}
              />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};
