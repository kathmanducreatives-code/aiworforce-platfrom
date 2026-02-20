import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import GrowthScoreBadge from "./GrowthScoreBadge";
import { Mail, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface Company {
  id: string;
  company_name: string;
  industry: string | null;
  funding_round: string | null;
  funding_amount: number | null;
  funding_date: string | null;
  open_roles_count: number;
  engineering_roles_count: number;
  growth_score: number;
  is_hot_lead: boolean;
  investors: any;
  source_url: string | null;
}

interface GrowthSignalTableProps {
  companies: Company[];
}

const formatAmount = (amount: number | null) => {
  if (!amount) return "—";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(0)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
};

const GrowthSignalTable = ({ companies }: GrowthSignalTableProps) => {
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border/30 hover:bg-transparent">
            <TableHead className="text-xs font-semibold">Company</TableHead>
            <TableHead className="text-xs font-semibold">Funding</TableHead>
            <TableHead className="text-xs font-semibold hidden md:table-cell">Amount</TableHead>
            <TableHead className="text-xs font-semibold">Roles</TableHead>
            <TableHead className="text-xs font-semibold">Score</TableHead>
            <TableHead className="text-xs font-semibold hidden lg:table-cell">Industry</TableHead>
            <TableHead className="text-xs font-semibold hidden lg:table-cell">Last Funded</TableHead>
            <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((c, i) => (
            <TableRow
              key={c.id}
              className="border-border/20 hover:bg-primary/5 transition-colors"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <TableCell>
                <div>
                  <p className="font-medium text-sm">{c.company_name}</p>
                  <p className="text-xs text-muted-foreground">{c.engineering_roles_count} eng roles</p>
                </div>
              </TableCell>
              <TableCell>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                  {c.funding_round || "—"}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm">{formatAmount(c.funding_amount)}</TableCell>
              <TableCell>
                <span className="text-sm font-semibold">{c.open_roles_count}</span>
              </TableCell>
              <TableCell>
                <GrowthScoreBadge score={c.growth_score} isHotLead={c.is_hot_lead} />
              </TableCell>
              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{c.industry || "—"}</TableCell>
              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                {c.funding_date ? new Date(c.funding_date).toLocaleDateString() : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-primary/30 hover:bg-primary/10 hover:border-primary/50 text-xs"
                  onClick={() => toast.success(`${c.company_name} added to outreach pipeline`)}
                >
                  <Mail className="h-3.5 w-3.5 mr-1" /> Outreach
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default GrowthSignalTable;
