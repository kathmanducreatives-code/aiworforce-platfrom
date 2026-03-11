import * as React from "react";
import { Check, Globe, X, Search, ChevronRight, Hash, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { REGIONAL_LOCATIONS, ALL_COUNTRIES } from "@/data/locations";
interface LocationMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}
export const LocationMultiSelect = ({
  value = [],
  onChange,
  placeholder = "Search regions or countries..."
}: LocationMultiSelectProps) => {
  const [isActive, setIsActive] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleSelect = (item: string) => {
    if (value.includes(item)) {
      onChange(value.filter(v => v !== item));
    } else {
      onChange([...value, item]);
    }
    inputRef.current?.focus();
  };
  const handleRemove = (item: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(value.filter(v => v !== item));
  };
  const getLabel = (val: string) => {
    const region = REGIONAL_LOCATIONS.find(r => r.id === val);
    if (region) return region.label;
    return val;
  };

  const filteredRegions = REGIONAL_LOCATIONS.filter(r => r.label.toLowerCase().includes(search.toLowerCase()));

  return <div className={cn("relative transition-all duration-300 ease-out-quart rounded-xl border", isActive ? "bg-card border-primary shadow-primary z-50 scale-[1.02]" : "bg-card border-border hover:border-primary/60 hover:shadow-md")}>
    {/* Header / Trigger Area */}
    <div className="flex flex-col gap-3 p-4 cursor-text bg-card rounded-xl" onClick={() => {
      setIsActive(true);
      inputRef.current?.focus();
    }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-foreground">
          <Globe className="w-5 h-5 shrink-0 text-primary" />
          <span className="text-sm tracking-wide uppercase text-foreground font-bold">Target Locations</span>
        </div>
      </div>

      {/* Selected Chips Area */}
      <div className="flex flex-wrap gap-2 min-h-[32px]">
        {value.map(val => <Badge key={val} variant="secondary" className="bg-primary/10 text-primary border border-primary/30 px-2 py-1 h-8 text-sm gap-1 hover:bg-primary/20 transition-colors animate-in fade-in zoom-in-50 duration-200">
          {getLabel(val)}
          <button type="button" className="ml-1 rounded-full p-0.5 hover:bg-primary/20 hover:text-primary transition-colors" onClick={e => handleRemove(val, e)}>
            <X className="w-3 h-3" />
          </button>
        </Badge>)}
        <input ref={inputRef} type="text" className="bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground h-8 min-w-[150px] flex-1 text-sm font-medium" placeholder={value.length === 0 ? placeholder : ""} value={search} onChange={e => setSearch(e.target.value)} onFocus={() => setIsActive(true)} onBlur={() => setTimeout(() => setIsActive(false), 200)}
        />
      </div>
    </div>

    {/* Sliding Dropdown Content */}
    <div className={cn("overflow-hidden transition-all duration-300 ease-out-quart rounded-b-xl", isActive ? "max-h-[300px] border-t border-border opacity-100" : "max-h-0 opacity-0 border-t-0")}>
      <div className="bg-muted/50 backdrop-blur-sm p-2">
        <div className="max-h-[280px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent pr-1">
          <div className="grid grid-cols-1 gap-1">
            {filteredRegions.length > 0 ? filteredRegions.map(region => {
              const matchingCountries = region.countries.filter(c => c.toLowerCase().includes(search.toLowerCase()) || region.label.toLowerCase().includes(search.toLowerCase()));
              if (matchingCountries.length === 0) return null;
              return <div key={region.id} className="mb-2">
                {/* Region Header */}
                <div className="px-3 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider bg-muted rounded-md mb-1 mx-1">
                  {region.label}
                </div>

                {/* Countries */}
                {matchingCountries.map(country => <div key={country} className={cn("flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ml-2", value.includes(country) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground hover:shadow-sm")} onMouseDown={e => {
                  e.preventDefault();
                  handleSelect(country);
                }}>
                  <div className={cn("w-4 h-4 rounded-sm border flex items-center justify-center transition-colors", value.includes(country) ? "border-primary bg-primary" : "border-border bg-card")}>
                    {value.includes(country) && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="font-medium text-sm">{country}</span>
                </div>)}
              </div>;
            }) : <div className="py-6 text-center text-muted-foreground text-sm">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-20" />
              No locations found matching "{search}"
            </div>}
          </div>
        </div>
      </div>
    </div>

    {/* Active Indicator Line */}
    <div className={cn("absolute bottom-0 left-0 h-[2px] bg-primary transition-all duration-500 ease-out rounded-b-xl", isActive ? "w-full shadow-primary" : "w-0")} />
  </div>;
};