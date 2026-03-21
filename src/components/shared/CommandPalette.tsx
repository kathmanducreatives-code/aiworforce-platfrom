import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import {
  LayoutDashboard, Activity, Calendar, Search, Brain, Target, TrendingUp,
  Mail, Share2, BarChart3, Plus, Upload, Zap, Users, Eye, Crosshair, Radar, Briefcase, Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';


interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const pages = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, group: 'Navigate' },
  { label: 'Job Screening', path: '/screening-jobs', icon: Briefcase, group: 'Navigate' },
  { label: 'Candidates', path: '/candidates', icon: Users, group: 'Navigate' },
  { label: 'Interviews', path: '/interview-scheduler', icon: Calendar, group: 'Navigate' },
  { label: 'Lead Scraper', path: '/lead-scraper', icon: Search, group: 'Navigate' },
  { label: 'Deep Search', path: '/deep-search', icon: Brain, group: 'Navigate' },
  { label: 'ICP Intelligence', path: '/icp-intelligence', icon: Target, group: 'Navigate' },
  { label: 'Growth Signals', path: '/growth-signals', icon: TrendingUp, group: 'Navigate' },
  { label: 'Talent Intel', path: '/talent-intel', icon: Users, group: 'Navigate' },
  { label: 'Competitor Intel', path: '/competitor-intel', icon: Eye, group: 'Navigate' },
  { label: 'Email Sequences', path: '/email-sequences', icon: Mail, group: 'Navigate' },
  { label: 'Job Distribution', path: '/distribution', icon: Share2, group: 'Navigate' },
  { label: 'Post Interceptor', path: '/post-interceptor', icon: Crosshair, group: 'Navigate' },
  { label: 'Lead CRM', path: '/lead-crm', icon: Zap, group: 'Navigate' },
  { label: 'Job Tracker', path: '/competitors', icon: Radar, group: 'Navigate' },
  { label: 'Analytics', path: '/analytics', icon: BarChart3, group: 'Navigate' },
];

const quickActions = [
  { label: 'Create New Job', path: '/screening-jobs', icon: Plus, group: 'Quick Actions' },
  { label: 'Upload Resume', path: '/screening', icon: Upload, group: 'Quick Actions' },
  { label: 'Start Lead Scrape', path: '/lead-scraper', icon: Zap, group: 'Quick Actions' },
];

interface SearchResult {
  id: string;
  label: string;
  subtitle: string;
  path: string;
  type: 'candidate' | 'lead' | 'job';
}

const CommandPalette = ({ open, onOpenChange }: CommandPaletteProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  // Search Supabase when query changes
  useEffect(() => {
    if (!open) { setQuery(''); setResults([]); return; }
    if (query.length < 2) { setResults([]); return; }

    const timer = setTimeout(async () => {
      setSearching(true);
      const searchResults: SearchResult[] = [];

      try {
        // Search candidates (resume_analyses)
        const { data: candidates } = await supabase
          .from('resume_analyses')
          .select('id, candidate_name, recruitment_name')
          .or(`candidate_name.ilike.%${query}%,recruitment_name.ilike.%${query}%`)
          .limit(5);

        if (candidates) {
          candidates.forEach(c => {
            searchResults.push({
              id: c.id,
              label: c.candidate_name || 'Unknown',
              subtitle: c.recruitment_name || 'Candidate',
              path: `/candidates/${c.id}`,
              type: 'candidate',
            });
          });
        }

        // Search leads
        const { data: leads } = await supabase
          .from('outreach_leads')
          .select('id, contact_name, company')
          .or(`contact_name.ilike.%${query}%,company.ilike.%${query}%`)
          .limit(5);

        if (leads) {
          leads.forEach(l => {
            searchResults.push({
              id: l.id,
              label: l.contact_name,
              subtitle: l.company,
              path: '/lead-crm',
              type: 'lead',
            });
          });
        }

        // Search screening jobs
        const { data: jobs } = await supabase
          .from('screening_jobs')
          .select('id, title, company_name')
          .or(`title.ilike.%${query}%,company_name.ilike.%${query}%`)
          .limit(5);

        if (jobs) {
          jobs.forEach(j => {
            searchResults.push({
              id: j.id,
              label: j.title,
              subtitle: j.company_name || 'Job',
              path: `/screening-jobs/${j.id}`,
              type: 'job',
            });
          });
        }
      } catch (err) {
        console.error('Search error:', err);
      }

      setResults(searchResults);
      setSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, open]);

  const handleSelect = useCallback((path: string) => {
    onOpenChange(false);
    navigate(path);
  }, [navigate, onOpenChange]);

  const typeIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'candidate': return <Users className="h-4 w-4 text-emerald-500" />;
      case 'lead': return <Zap className="h-4 w-4 text-amber-500" />;
      case 'job': return <Briefcase className="h-4 w-4 text-primary" />;
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search candidates, leads, jobs, or navigate..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {searching ? (
            <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching...
            </div>
          ) : (
            'No results found.'
          )}
        </CommandEmpty>

        {/* Live search results */}
        {results.length > 0 && (
          <>
            <CommandGroup heading="Search Results">
              {results.map((r) => (
                <CommandItem key={`${r.type}-${r.id}`} onSelect={() => handleSelect(r.path)} className="gap-3 cursor-pointer">
                  {typeIcon(r.type)}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{r.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">{r.subtitle}</span>
                  </div>
                  <span className="text-[10px] uppercase text-muted-foreground/60 font-medium">{r.type}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Quick Actions */}
        <CommandGroup heading="Quick Actions">
          {quickActions.map((action) => (
            <CommandItem key={action.path + action.label} onSelect={() => handleSelect(action.path)} className="gap-3 cursor-pointer">
              <action.icon className="h-4 w-4 text-primary" />
              <span>{action.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />

        {/* Navigate */}
        <CommandGroup heading="Navigate">
          {pages.map((page) => (
            <CommandItem key={page.path} onSelect={() => handleSelect(page.path)} className="gap-3 cursor-pointer">
              <page.icon className="h-4 w-4 text-muted-foreground" />
              <span>{page.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

export default CommandPalette;
