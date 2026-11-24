// Agency Brain ↔ client Brains (Phase 3c, held). Rendered only when the user
// holds at least one client grant and client Brains are switched on; lists
// only the clients the server returned for this user.
import { Building2, Users } from 'lucide-react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { BrainClient } from '@/lib/clientBrainApi';
import type { BrainScope } from '@/lib/brainScope';

const AGENCY = '__agency__';

export function BrainScopeSwitcher({ scope, clients, onSelect, disabled }: {
  scope: BrainScope;
  clients: readonly BrainClient[];
  onSelect: (clientId: string | null) => void;
  disabled?: boolean;
}) {
  const value = scope.kind === 'client' ? scope.clientId : AGENCY;
  return (
    <Select value={value} onValueChange={(v) => onSelect(v === AGENCY ? null : v)} disabled={disabled}>
      <SelectTrigger aria-label="Choose which Company Brain to view" className="h-8 w-auto min-w-[11rem] max-w-[16rem] gap-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={AGENCY} className="text-xs">
          <span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />Your company</span>
        </SelectItem>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel className="text-[10px] font-medium uppercase tracking-[.14em] text-muted-foreground">Clients</SelectLabel>
          {clients.map((c) => (
            <SelectItem key={c.clientId} value={c.clientId} className="text-xs">
              <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{c.name}</span></span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
