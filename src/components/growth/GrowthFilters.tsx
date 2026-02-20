import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

interface GrowthFiltersProps {
  industry: string;
  setIndustry: (v: string) => void;
  fundingStage: string;
  setFundingStage: (v: string) => void;
  scoreRange: number[];
  setScoreRange: (v: number[]) => void;
  hiringMin: string;
  setHiringMin: (v: string) => void;
}

const GrowthFilters = ({ industry, setIndustry, fundingStage, setFundingStage, scoreRange, setScoreRange, hiringMin, setHiringMin }: GrowthFiltersProps) => {
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Industry</Label>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="border-border/60 bg-background/60"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Industries</SelectItem>
              <SelectItem value="SaaS">SaaS</SelectItem>
              <SelectItem value="Fintech">Fintech</SelectItem>
              <SelectItem value="HealthTech">HealthTech</SelectItem>
              <SelectItem value="EdTech">EdTech</SelectItem>
              <SelectItem value="AI/ML">AI/ML</SelectItem>
              <SelectItem value="E-commerce">E-commerce</SelectItem>
              <SelectItem value="Cybersecurity">Cybersecurity</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Funding Stage</Label>
          <Select value={fundingStage} onValueChange={setFundingStage}>
            <SelectTrigger className="border-border/60 bg-background/60"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              <SelectItem value="Seed">Seed</SelectItem>
              <SelectItem value="Series A">Series A</SelectItem>
              <SelectItem value="Series B">Series B</SelectItem>
              <SelectItem value="Series C">Series C</SelectItem>
              <SelectItem value="Series D+">Series D+</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Min Score: {scoreRange[0]}</Label>
          <Slider value={scoreRange} onValueChange={setScoreRange} min={0} max={100} step={10} className="mt-2" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Min Hiring Volume</Label>
          <Select value={hiringMin} onValueChange={setHiringMin}>
            <SelectTrigger className="border-border/60 bg-background/60"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any</SelectItem>
              <SelectItem value="5">5+ roles</SelectItem>
              <SelectItem value="10">10+ roles</SelectItem>
              <SelectItem value="20">20+ roles</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default GrowthFilters;
