import * as React from "react";
import { Check, Globe, X, Search, ChevronRight, Hash, MapPin } from "lucide-react";
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
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { REGIONAL_LOCATIONS, ALL_COUNTRIES } from "@/data/locations";

interface LocationMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export const LocationMultiSelect = ({
  value = [],
  onChange,
  placeholder = "Search regions or countries...",
}: LocationMultiSelectProps) => {
  const [isActive, setIsActive] = React.useState(false);
  const [search, setSearch] = React.useState(""); // Added search state
  const inputRef = React.useRef<HTMLInputElement>(null); // Added inputRef

  const handleSelect = (item: string) => {
    if (value.includes(item)) {
      onChange(value.filter((v) => v !== item));
    } else {
      onChange([...value, item]);
    }
    inputRef.current?.focus();
  };

  const handleRemove = (item: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(value.filter((v) => v !== item));
  };

  const getLabel = (val: string) => {
    const region = REGIONAL_LOCATIONS.find(r => r.id === val);
    if (region) return region.label;
    return val;
  };

  // Filter regions/countries based on search
  const filteredRegions = REGIONAL_LOCATIONS.filter(r =>
    r.label.toLowerCase().includes(search.toLowerCase())
  );
  // Combine robustly if needed, for now using just regions from the original mock data
  // Would expand to ALL_COUNTRIES if the list is manageable in client side or use async

  return (
    <div className={cn(
      "relative transition-all duration-300 ease-out-quart rounded-xl border",
      isActive
        ? "bg-[#161616] border-[#00FF85] shadow-[0_0_20px_rgba(0,255,133,0.2)] z-50 scale-[1.02]"
        : "bg-[#161616] border-[#00FF85]/30 hover:border-[#00FF85]/60 hover:shadow-[0_0_15px_rgba(0,255,133,0.1)]"
    )}>
      {/* Header / Trigger Area */}
      <div
        className="flex flex-col gap-3 p-4 cursor-text"
        onClick={() => { setIsActive(true); inputRef.current?.focus(); }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-[#00FF85]">
            <Globe className="w-5 h-5 shrink-0" />
            <span className="text-sm font-bold tracking-wide uppercase">Target Locations</span>
          </div>
        </div>

        {/* Selected Chips Area */}
        <div className="flex flex-wrap gap-2 min-h-[32px]">
          {value.map((val) => (
            <Badge
              key={val}
              variant="secondary"
              className="bg-[#00FF85]/10 text-[#00FF85] border border-[#00FF85]/30 px-2 py-1 h-8 text-sm gap-1 hover:bg-[#00FF85]/20 transition-colors animate-in fade-in zoom-in-50 duration-200"
            >
              {getLabel(val)}
              <button
                type="button"
                className="ml-1 rounded-full p-0.5 hover:bg-[#00FF85]/20 hover:text-white transition-colors"
                onClick={(e) => handleRemove(val, e)}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          <input
            ref={inputRef}
            type="text"
            className="bg-transparent border-none outline-none text-white placeholder:text-muted-foreground/50 h-8 min-w-[150px] flex-1 text-sm font-medium"
            placeholder={value.length === 0 ? placeholder : ""}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setIsActive(true)}
            onBlur={() => setTimeout(() => setIsActive(false), 200)} // Delay for click handling
          />
        </div>
      </div>

      {/* Sliding Dropdown Content */}
      <div className={cn(
        "overflow-hidden transition-all duration-300 ease-out-quart",
        isActive ? "max-h-[300px] border-t border-[#00FF85]/20 opacity-100 p-2" : "max-h-0 opacity-0 border-t-0 p-0"
      )}>
        <div className="max-h-[290px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#00FF85]/20 scrollbar-track-transparent pr-1">
          <div className="grid grid-cols-1 gap-1">
            {filteredRegions.length > 0 ? (
              // If searching regions/countries, we still want to maintain hierarchy if possible, 
              // OR just show flattened results if search is active. 
              // User requirement: "North America > USA, Canada, Mexico". 
              // Let's iterate Regions and render children.

              filteredRegions.map((region) => {
                // Filter countries if search is active
                const matchingCountries = region.countries.filter(c =>
                  c.toLowerCase().includes(search.toLowerCase()) ||
                  region.label.toLowerCase().includes(search.toLowerCase())
                );

                if (matchingCountries.length === 0) return null;

                return (
                  <div key={region.id} className="mb-2">
                    {/* Region Header */}
                    <div className="px-3 py-1.5 text-xs font-bold text-[#00FF85] uppercase tracking-wider bg-white/5 rounded-md mb-1 mx-1">
                      {region.label}
                    </div>

                    {/* Countries */}
                    {matchingCountries.map(country => (
                      <div
                        key={country}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ml-2",
                          value.includes(country)
                            ? "bg-[#00FF85]/10 text-[#00FF85]"
                            : "text-muted-foreground hover:bg-white/5 hover:text-white"
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault(); // Prevent blur
                          handleSelect(country);
                        }}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded-sm border flex items-center justify-center transition-colors",
                          value.includes(country)
                            ? "border-[#00FF85] bg-[#00FF85]"
                            : "border-muted-foreground/40"
                        )}>
                          {value.includes(country) && <Check className="w-3 h-3 text-black" />}
                        </div>
                        <span className="font-medium text-sm">{country}</span>
                      </div>
                    ))}
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-muted-foreground text-sm">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-20" />
                No locations found matching "{search}"
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Active Indicator Line */}
      <div className={cn(
        "absolute bottom-0 left-0 h-[2px] bg-[#00FF85] transition-all duration-500 ease-out",
        isActive ? "w-full shadow-[0_-2px_10px_rgba(0,255,133,0.5)]" : "w-0"
      )} />
    </div>
  );
};


