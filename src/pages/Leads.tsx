import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, Bookmark, Target, Brain } from "lucide-react";
import LeadScraper from "./LeadScraper";
import LeadCRM from "./LeadCRM";
import ICPManager from "./ICPManager";
import DeepSearch from "./DeepSearch";

const TABS = [
  { id: "find",     label: "Find leads",  icon: Search,   desc: "Describe who you want to reach. Scout will source matching accounts and people." },
  { id: "saved",    label: "Saved leads", icon: Bookmark, desc: "Leads you've kept for outreach or follow-up." },
  { id: "icp",      label: "ICP",         icon: Target,   desc: "Define and refine your ideal customer profile." },
  { id: "research", label: "Research",    icon: Brain,    desc: "Deep research on people and accounts showing buying signals." },
] as const;

type TabId = typeof TABS[number]["id"];

export default function Leads() {
  const [params, setParams] = useSearchParams();
  const initial = (params.get("tab") as TabId) || "find";
  const [tab, setTab] = useState<TabId>(initial);

  const handleTab = (v: string) => {
    setTab(v as TabId);
    setParams({ tab: v }, { replace: true });
  };

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6">
        <header className="mb-6">
          <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Leads</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Find accounts and people showing buying signals.
          </p>
        </header>

        <Tabs value={tab} onValueChange={handleTab} className="w-full">
          <TabsList className="bg-card/50 border border-border">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                <t.icon className="h-3.5 w-3.5 mr-1.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <p className="text-xs text-muted-foreground mt-3 mb-4">{active.desc}</p>

          <TabsContent value="find" className="mt-0"><LeadScraper /></TabsContent>
          <TabsContent value="saved" className="mt-0"><LeadCRM /></TabsContent>
          <TabsContent value="icp" className="mt-0"><ICPManager /></TabsContent>
          <TabsContent value="research" className="mt-0"><DeepSearch /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
