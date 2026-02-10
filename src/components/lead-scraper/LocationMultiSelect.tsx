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
  const [search, setSearch] = React.useState(""); // Added search state
  const inputRef = React.useRef<HTMLInputElement>(null); // Added inputRef

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

  // Filter regions/countries based on search
  const filteredRegions = REGIONAL_LOCATIONS.filter(r => r.label.toLowerCase().includes(search.toLowerCase()));

  return <div className={cn("relative transition-all duration-300 ease-out-quart rounded-xl border", isActive ? "bg-white border-[#00FF85] shadow-[0_0_20px_rgba(0,255,133,0.2)] z-50 scale-[1.02]" : "bg-white border-gray-200 hover:border-[#00FF85]/60 hover:shadow-md")}>
    {/* Header / Trigger Area */}
    <div className="flex flex-col gap-3 p-4 cursor-text bg-white rounded-xl" onClick={() => {
      setIsActive(true);
      inputRef.current?.focus();
    }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-gray-900">
          <Globe className="w-5 h-5 shrink-0 text-[#059467]" />
          <span className="text-sm tracking-wide uppercase text-gray-700 font-bold">Target Locations</span>
        </div>
      </div>

      {/* Selected Chips Area */}
      <div className="flex flex-wrap gap-2 min-h-[32px]">
        {value.map(val => <Badge key={val} variant="secondary" className="bg-[#00FF85]/10 text-emerald-700 border border-[#00FF85]/30 px-2 py-1 h-8 text-sm gap-1 hover:bg-[#00FF85]/20 transition-colors animate-in fade-in zoom-in-50 duration-200">
          {getLabel(val)}
          <button type="button" className="ml-1 rounded-full p-0.5 hover:bg-[#00FF85]/20 hover:text-emerald-900 transition-colors" onClick={e => handleRemove(val, e)}>
            <X className="w-3 h-3" />
          </button>
        </Badge>)}
        <input ref={inputRef} type="text" className="bg-transparent border-none outline-none text-gray-900 placeholder:text-gray-400 h-8 min-w-[150px] flex-1 text-sm font-medium" placeholder={value.length === 0 ? placeholder : ""} value={search} onChange={e => setSearch(e.target.value)} onFocus={() => setIsActive(true)} onBlur={() => setTimeout(() => setIsActive(false), 200)} // Delay for click handling
        />
      </div>
    </div>

    {/* Sliding Dropdown Content */}
    <div className={cn("overflow-hidden transition-all duration-300 ease-out-quart rounded-b-xl", isActive ? "max-h-[300px] border-t border-gray-100 opacity-100" : "max-h-0 opacity-0 border-t-0")}>
      <div className="bg-gray-50/80 backdrop-blur-sm p-2">
        <div className="max-h-[280px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent pr-1">
          <div className="grid grid-cols-1 gap-1">
            {filteredRegions.length > 0 ? filteredRegions.map(region => {
              // Filter countries if search is active
              const matchingCountries = region.countries.filter(c => c.toLowerCase().includes(search.toLowerCase()) || region.label.toLowerCase().includes(search.toLowerCase()));
              if (matchingCountries.length === 0) return null;
              return <div key={region.id} className="mb-2">
                {/* Region Header */}
                <div className="px-3 py-1.5 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-200/50 rounded-md mb-1 mx-1">
                  {region.label}
                </div>

                {/* Countries */}
                {matchingCountries.map(country => <div key={country} className={cn("flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ml-2", value.includes(country) ? "bg-[#00FF85]/10 text-emerald-700" : "text-gray-600 hover:bg-white hover:text-gray-900 hover:shadow-sm")} onMouseDown={e => {
                  e.preventDefault(); // Prevent blur
                  handleSelect(country);
                }}>
                  <div className={cn("w-4 h-4 rounded-sm border flex items-center justify-center transition-colors", value.includes(country) ? "border-[#00FF85] bg-[#00FF85]" : "border-gray-300 bg-white")}>
                    {value.includes(country) && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="font-medium text-sm">{country}</span>
                </div>)}
              </div>;
            }) : <div className="py-6 text-center text-gray-500 text-sm">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-20" />
              No locations found matching "{search}"
            </div>}
          </div>
        </div>
      </div>
    </div>

    {/* Active Indicator Line */}
    <div className={cn("absolute bottom-0 left-0 h-[2px] bg-[#00FF85] transition-all duration-500 ease-out rounded-b-xl", isActive ? "w-full shadow-[0_-2px_10px_rgba(0,255,133,0.5)]" : "w-0")} />
  </div>;
};