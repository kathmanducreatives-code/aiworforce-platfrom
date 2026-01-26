import * as React from "react";
import { Check, ChevronsUpDown, MapPin, X } from "lucide-react";
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
// Label import removed

// Popular countries shown first
const POPULAR_COUNTRIES = [
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "India",
  "Singapore",
  "Netherlands",
  "Sweden",
  "Japan",
  "Brazil",
  "United Arab Emirates",
  "Switzerland",
  "Ireland",
];

const REGIONS = [
  "North America",
  "Europe",
  "APAC",
  "EMEA",
  "LATAM",
  "Southeast Asia",
  "Nordics",
  "DACH",
];

const MAJOR_CITIES = [
  "New York, NY", "San Francisco, CA", "London, UK", "New York", "London",
  "San Francisco", "Austin, TX", "Los Angeles, CA", "Chicago, IL",
  "Toronto, Canada", "Berlin, Germany", "Paris, France", "Amsterdam, Netherlands",
  "Singapore", "Tokyo, Japan", "Sydney, Australia", "Dubai, UAE",
  "Bangalore, India", "Mumbai, India", "Tel Aviv, Israel", "São Paulo, Brazil",
  "Mexico City, Mexico", "Hong Kong"
];

// Complete list of countries
const ALL_COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
  "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
  "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
  "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada",
  "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
  "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica",
  "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea",
  "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
  "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary",
  "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati",
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia",
  "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi",
  "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania",
  "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia",
  "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
  "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea",
  "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama",
  "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
  "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe",
  "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
  "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea",
  "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland",
  "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo",
  "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
  "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam",
  "Yemen", "Zambia", "Zimbabwe"
];

interface LocationMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export const LocationMultiSelect = ({
  value,
  onChange,
  placeholder = "Search countries...",
}: LocationMultiSelectProps) => {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const handleSelect = (country: string) => {
    if (value.includes(country)) {
      onChange(value.filter((v) => v !== country));
    } else {
      onChange([...value, country]);
    }
  };

  const handleRemove = (country: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(value.filter((v) => v !== country));
  };

  // Filter lists based on search
  const filteredRegions = REGIONS.filter(
    (region) =>
      region.toLowerCase().includes(search.toLowerCase()) &&
      !value.includes(region)
  );

  const filteredCities = MAJOR_CITIES.filter(
    (city) =>
      city.toLowerCase().includes(search.toLowerCase()) &&
      !value.includes(city)
  );

  const filteredPopular = POPULAR_COUNTRIES.filter(
    (country) =>
      country.toLowerCase().includes(search.toLowerCase()) &&
      !value.includes(country)
  );

  const filteredAll = ALL_COUNTRIES.filter(
    (country) =>
      country.toLowerCase().includes(search.toLowerCase()) &&
      !POPULAR_COUNTRIES.includes(country)
  );

  return (
    <div className="space-y-2">

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select locations"
            className={cn(
              "w-full h-9 lg:h-10 justify-between bg-background/50 border-border/50 hover:bg-background/80 hover:border-primary/30 transition-colors text-sm font-normal",
              !value.length && "text-muted-foreground"
            )}
          >
            <span className="truncate">
              {value.length > 0
                ? `${value.length} location${value.length > 1 ? "s" : ""} selected`
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
          <Command className="bg-transparent">
            <CommandInput
              placeholder="Search countries..."
              value={search}
              onValueChange={setSearch}
              className="h-9 text-sm"
            />
            <CommandList className="max-h-[280px] overflow-y-auto">
              <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
                No country found.
              </CommandEmpty>

              {/* Selected items at top */}
              {value.length > 0 && (
                <CommandGroup heading="Selected">
                  {value.map((country) => (
                    <CommandItem
                      key={`selected-${country}`}
                      value={country}
                      onSelect={() => handleSelect(country)}
                      className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                    >
                      <Check className="h-4 w-4 text-primary shrink-0" />
                      <span className="flex-1 truncate">{country}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Regions */}
              {filteredRegions.length > 0 && (
                <CommandGroup heading="Regions">
                  {filteredRegions.map((region) => (
                    <CommandItem
                      key={region}
                      value={region}
                      onSelect={() => handleSelect(region)}
                      className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                    >
                      <div className="h-4 w-4 border border-border/50 rounded-sm shrink-0" />
                      <span className="flex-1 truncate">{region}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Cities */}
              {filteredCities.length > 0 && (
                <CommandGroup heading="Cities">
                  {filteredCities.map((city) => (
                    <CommandItem
                      key={city}
                      value={city}
                      onSelect={() => handleSelect(city)}
                      className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                    >
                      <div className="h-4 w-4 border border-border/50 rounded-sm shrink-0" />
                      <span className="flex-1 truncate">{city}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Popular countries */}
              {filteredPopular.length > 0 && (
                <CommandGroup heading="Popular">
                  {filteredPopular.map((country) => (
                    <CommandItem
                      key={country}
                      value={country}
                      onSelect={() => handleSelect(country)}
                      className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                    >
                      <div className="h-4 w-4 border border-border/50 rounded-sm shrink-0" />
                      <span className="flex-1 truncate">{country}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* All countries */}
              {filteredAll.length > 0 && (
                <CommandGroup heading="All Countries">
                  {filteredAll.map((country) => {
                    const isSelected = value.includes(country);
                    return (
                      <CommandItem
                        key={country}
                        value={country}
                        onSelect={() => handleSelect(country)}
                        className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                      >
                        {isSelected ? (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <div className="h-4 w-4 border border-border/50 rounded-sm shrink-0" />
                        )}
                        <span className="flex-1 truncate">{country}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected badges */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.map((country) => (
            <Badge
              key={country}
              variant="secondary"
              className="px-2 py-1 text-xs cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors group max-w-[150px] bg-primary/10 text-primary border-primary/20"
            >
              <span className="truncate">{country}</span>
              <X
                className="w-2.5 h-2.5 ml-1 opacity-60 group-hover:opacity-100 shrink-0"
                onClick={(e) => handleRemove(country, e)}
              />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};
