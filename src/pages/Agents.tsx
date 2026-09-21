import AgentPortrait from '@/components/agents/AgentPortrait';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Plus, Network, ArrowRight, Activity, Search } from 'lucide-react';
import { PUBLIC_AGENTS, PUBLIC_AGENT_ORDER, type PublicAgentProfile } from '@/config/agentRegistry';
import { openAgentBuilder } from '@/hooks/useAgentBuilder';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import { prepareChatDraft } from '@/lib/chatDraft';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { DBAgent, DBActivity } from '@/lib/orchestration';

type SavedAgent = DBAgent & { is_default: boolean; role_prompt: string; tools: string[]; agent_capabilities: { capability: string; enabled: boolean }[] };
type Member = { id: string; name: string; title: string; description: string; accentHex: string; avatar?: string; capabilities: readonly string[]; records: SavedAgent[]; slug: string; custom?: boolean };
const statusLabels: Record<string, string> = { running: 'Working', idle: 'Ready', awaiting_approval: 'Needs review', error: 'Needs attention' };
function status(member: Member, loading: boolean, error: boolean) {
  if (loading) return 'Loading';
  if (error) return 'Unavailable';
  return ['error', 'awaiting_approval', 'running', 'idle'].map(s => member.records.some(a => a.status === s) ? statusLabels[s] : '').find(Boolean) || 'Not configured';
}
function Portrait({ member, large = false }: { member: Member; large?: boolean }) {
  return <AgentPortrait agentId={member.id} name={member.name} src={member.avatar} size={large ? 80 : 56} shape="squircle" />;
}
export default function Agents() {
  const { workspaceId } = useWorkspace();
  const chat = useChatWorkspace();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const roster = useQuery({ queryKey: ['agent-roster', workspaceId], enabled: !!workspaceId, refetchInterval: 30000, queryFn: async () => {
    const { data, error } = await supabase.from('agents').select('*, agent_capabilities(capability, enabled)').eq('workspace_id', workspaceId!).order('created_at');
    if (error) throw error;
    return data as unknown as SavedAgent[];
  }});
  const activity = useQuery({ queryKey: ['agent-roster-activity', workspaceId], enabled: !!workspaceId, refetchInterval: 30000, queryFn: async () => {
    const { data, error } = await supabase.from('activity_feed').select('*').eq('workspace_id', workspaceId!).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data as unknown as DBActivity[];
  }});
  const rows = roster.data ?? [];
  const canonical = PUBLIC_AGENT_ORDER.map(id => {
    const p: PublicAgentProfile = PUBLIC_AGENTS[id];
    return { ...p, records: rows.filter(a => a.is_default !== false && (a.slug === id || (p.legacySlugs as readonly string[]).includes(a.slug))), slug: id } as Member;
  });
  const known = new Set(canonical.flatMap(a => a.records.map(r => r.id)));
  const custom: Member[] = rows.filter(a => !known.has(a.id)).map(a => ({ id: a.id, name: a.name, title: `${a.department} specialist`, description: a.role_prompt || 'A specialist created for your workspace.', accentHex: '#10B981', capabilities: a.agent_capabilities?.filter(c => c.enabled).map(c => c.capability) ?? [], records: [a], slug: a.slug, custom: true }));
  const members = [...canonical, ...custom];
  const member = members.find(a => a.id === selected);
  const loading = roster.isPending;
  const recent = (m: Member) => (activity.data ?? []).filter(e => m.records.some(a => a.id === e.agent_id));
  const assign = (m: Member) => { setSelected(null); chat.setView({ kind: 'agent', slug: m.slug }); prepareChatDraft(''); chat.open(); };
  const visible = [...canonical.slice(1), ...custom].filter(a => (filter !== 'custom' || a.custom) && `${a.name} ${a.title} ${a.capabilities.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const pilot = canonical[0];
  return <div className="mx-auto max-w-[1280px] px-5 py-7 lg:px-8 pb-36 space-y-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-[10px] tracking-[.2em] uppercase text-primary mb-2">Your workforce</p><h1 className="text-3xl font-semibold tracking-tight">AI Team</h1><p className="mt-2 text-sm text-muted-foreground">Specialists with a purpose. One coordinated team.</p></div><Button onClick={() => openAgentBuilder()}><Plus className="mr-2 h-4 w-4" />New agent</Button></header>
    {roster.isError && <div role="alert" className="rounded-xl border border-amber-500/30 p-4 text-sm">Saved agents could not be loaded. <button className="underline" onClick={() => roster.refetch()}>Try again</button></div>}
    <section aria-label="Workforce coordinator" className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.09] via-card/70 to-card/40 p-6 lg:p-8">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.18em] text-primary mb-6"><Network className="w-3.5 h-3.5" />Workforce coordinator</div>
      <div className="flex flex-col xl:flex-row justify-between gap-6"><div className="flex items-start gap-5"><Portrait member={pilot} large /><div><div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl font-semibold tracking-tight">Pilot</h2><span className="text-xs text-muted-foreground">{status(pilot, loading, roster.isError)}</span></div><p className="text-sm text-muted-foreground leading-relaxed mt-2 max-w-lg">Give your team a goal. Pilot coordinates the specialists and brings the results back for your review.</p><div className="flex flex-wrap gap-3 mt-5"><Button size="sm" onClick={() => assign(pilot)}>Plan with Pilot<ArrowUpRight className="ml-2 h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => setSelected('pilot')}>View profile</Button></div></div></div><div className="flex xl:flex-col gap-6 xl:gap-2 xl:border-l border-border xl:pl-7 text-sm shrink-0"><span><strong className="text-xl font-medium mr-2">{canonical.length - 1}</strong><span className="text-muted-foreground">specialists</span></span><span><strong className="text-xl font-medium mr-2">{loading || roster.isError ? '—' : custom.length}</strong><span className="text-muted-foreground">custom agents</span></span><span className="text-xs text-muted-foreground mt-2">You stay in control of approvals.</span></div></div>
    </section>
    <section aria-label="Specialists" className="space-y-5"><div className="flex flex-wrap justify-between gap-4 items-center"><div className="flex gap-1 rounded-lg border border-border p-1"><button onClick={() => setFilter('all')} className={`rounded-md px-3 py-1.5 text-xs ${filter === 'all' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>All specialists</button><button onClick={() => setFilter('custom')} className={`rounded-md px-3 py-1.5 text-xs ${filter === 'custom' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>Custom agents</button></div><label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground"><Search className="h-3.5 w-3.5" /><input aria-label="Search agents" placeholder="Find a specialist…" value={search} onChange={e => setSearch(e.target.value)} className="bg-transparent text-xs outline-none w-40" /></label></div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{visible.map(a => <article key={a.id} className="group rounded-2xl border border-border bg-card/60 p-5 sm:p-6 hover:border-white/20 transition-colors flex flex-col">
        <div className="flex items-start gap-3"><Portrait member={a} /><div className="min-w-0 flex-1"><h3 className="font-semibold text-lg tracking-tight">{a.name}</h3><p className="text-xs text-muted-foreground mt-1 capitalize">{a.title}</p></div><span className="text-[10px] rounded-full border border-border px-2 py-1 text-muted-foreground shrink-0">{status(a, loading, roster.isError)}</span></div>
        <p className="text-sm text-muted-foreground leading-relaxed mt-5 line-clamp-3 min-h-[60px]">{a.description}</p><div className="flex flex-wrap gap-1.5 mt-4">{a.capabilities.slice(0, 3).map(c => <span key={c} className="rounded-md border px-2 py-1 text-[10px] capitalize" style={{ color: a.accentHex, borderColor: `${a.accentHex}25`, background: `${a.accentHex}08` }}>{c.replaceAll('_', ' ')}</span>)}</div>
        <div className="mt-5 pt-4 border-t border-border flex items-start gap-2 text-xs text-muted-foreground"><Activity className="h-3.5 w-3.5 shrink-0 mt-0.5" /><p className="line-clamp-2">{activity.isPending ? 'Loading activity…' : activity.isError ? 'Activity unavailable' : recent(a)[0]?.title ?? 'No recent activity recorded'}</p></div><div className="mt-auto pt-5 flex items-center justify-between"><button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(a.id)}>View profile</button><button className="inline-flex items-center gap-2 text-xs font-medium hover:text-primary" onClick={() => assign(a)}>Assign task<ArrowUpRight className="h-3.5 w-3.5" /></button></div>
      </article>)}</div>{visible.length === 0 && <div className="rounded-2xl border border-dashed border-border py-12 text-center"><p className="text-sm text-muted-foreground">{search ? 'No agents match your search.' : 'Build a specialist for the way your team works.'}</p>{!search && <Button className="mt-4" variant="outline" onClick={() => openAgentBuilder()}>Create your first agent</Button>}</div>}
    </section>
    <Sheet open={!!member} onOpenChange={open => !open && setSelected(null)}><SheetContent className="w-full sm:max-w-lg overflow-y-auto">{member && <><SheetHeader><div className="mb-4"><Portrait member={member} large /></div><SheetTitle className="text-2xl">{member.name}</SheetTitle><SheetDescription>{member.title}</SheetDescription></SheetHeader><p className="text-sm leading-relaxed text-muted-foreground mt-6">{member.description}</p><Button className="mt-5 w-full" onClick={() => assign(member)}>Assign a task<ArrowRight className="ml-2 h-4 w-4" /></Button><h3 className="font-medium text-sm mt-8 mb-3">Capabilities</h3><div className="flex flex-wrap gap-2">{member.capabilities.map(c => <span key={c} className="text-xs capitalize rounded-md bg-muted px-2 py-1">{c.replaceAll('_', ' ')}</span>)}</div><h3 className="font-medium text-sm mt-8 mb-3">Recent work</h3>{activity.isError ? <p className="text-xs text-muted-foreground">Activity could not be loaded.</p> : recent(member).length ? recent(member).slice(0, 6).map(e => <div key={e.id} className="border-l border-border pl-3 pb-4"><p className="text-sm">{e.title}</p><time className="text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString()}</time></div>) : <p className="text-xs text-muted-foreground">No recent activity recorded.</p>}<h3 className="font-medium text-sm mt-6 mb-3">Tools</h3><p className="text-xs text-muted-foreground">{[...new Set(member.records.flatMap(a => a.tools ?? []))].join(', ') || 'No tools recorded for this agent.'}</p>{member.custom && <AgentSettings key={member.id} agent={member.records[0]} onSaved={() => queryClient.invalidateQueries({ queryKey: ['agent-roster', workspaceId] })} />}</>}</SheetContent></Sheet>
  </div>;
}
function AgentSettings({ agent, onSaved }: { agent: SavedAgent; onSaved: () => void }) {
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role_prompt ?? '');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { const { error } = await supabase.from('agents').update({ name: name.trim(), role_prompt: role.trim() }).eq('id', agent.id).eq('workspace_id', agent.workspace_id).select('id').single(); if (error) throw error; onSaved(); toast.success('Agent updated'); } catch { toast.error('Could not save agent settings'); } finally { setSaving(false); }
  }
  return <div className="mt-8 pt-6 border-t border-border space-y-3"><h3 className="text-sm font-medium">Agent settings</h3><label className="block text-xs text-muted-foreground">Name<input maxLength={60} value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-md border border-border bg-muted p-2 text-foreground" /></label><label className="block text-xs text-muted-foreground">Responsibilities<textarea value={role} onChange={e => setRole(e.target.value)} rows={5} className="mt-2 w-full rounded-md border border-border bg-muted p-2 text-foreground" /></label><p className="text-xs text-muted-foreground">Configured model: {agent.model}</p><Button disabled={saving || !name.trim() || role.trim().length < 50 || (name === agent.name && role === agent.role_prompt)} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button></div>;
}
