import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Calculator, TrendingDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";

const SCREENING_PILOT_COST = 299; // flat monthly fee

const AgencyCostCalculator = () => {
  const [roleType, setRoleType] = useState("engineering");
  const [salary, setSalary] = useState(120000);
  const [agencyFee, setAgencyFee] = useState([20]);

  const agencyCost = Math.round(salary * (agencyFee[0] / 100));
  const savings = agencyCost - SCREENING_PILOT_COST;
  const savingsPercent = agencyCost > 0 ? Math.round((savings / agencyCost) * 100) : 0;

  const chartData = [
    { name: "Agency", cost: agencyCost, fill: "hsl(var(--destructive))" },
    { name: "ScreeningPilot", cost: SCREENING_PILOT_COST, fill: "hsl(var(--primary))" },
  ];

  return (
    <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-5 space-y-5">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
          <Calculator className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">Agency Cost Calculator</h3>
          <p className="text-xs text-muted-foreground">Compare agency fees vs ScreeningPilot</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Role Type</Label>
          <Select value={roleType} onValueChange={setRoleType}>
            <SelectTrigger className="border-border/60 bg-background/60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="engineering">Engineering</SelectItem>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="design">Design</SelectItem>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="marketing">Marketing</SelectItem>
              <SelectItem value="executive">Executive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Annual Salary</Label>
          <Input
            type="number"
            value={salary}
            onChange={e => setSalary(parseInt(e.target.value) || 0)}
            className="border-border/60 bg-background/60"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Agency Fee: {agencyFee[0]}%</Label>
          <Slider value={agencyFee} onValueChange={setAgencyFee} min={10} max={30} step={1} className="mt-2" />
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-center">
          <p className="text-lg font-bold text-destructive">${agencyCost.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Agency Cost</p>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
          <p className="text-lg font-bold text-primary">${SCREENING_PILOT_COST}</p>
          <p className="text-xs text-muted-foreground">ScreeningPilot</p>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
          <p className="text-lg font-bold text-emerald-400 flex items-center justify-center gap-1">
            <TrendingDown className="h-4 w-4" /> {savingsPercent}%
          </p>
          <p className="text-xs text-muted-foreground">Savings</p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value: number) => `$${value.toLocaleString()}`}
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
            />
            <Bar dataKey="cost" radius={[0, 6, 6, 0]} barSize={24}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default AgencyCostCalculator;
