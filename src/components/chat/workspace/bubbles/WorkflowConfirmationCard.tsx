import { useState } from 'react';
import { Play, Settings2, ShieldCheck, AlertCircle, Sparkles, ArrowRight, ChevronDown, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  capabilityLabel, isMission, missionCapabilities, missionDryRun, missionRejectedBroadening, missionRows,
  provenanceLabel, type MissionLike, type MissionRow,
} from '@/lib/leadMission/missionView';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dispatchChatAction } from '@/lib/chatActions';
import { AGENT_BY_ID } from '@/data/agentProfiles';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';
import {
  isQualifiedLeadPayload, buildWorkflowPreview, buildStartWorkflowPayload,
  type QualifiedLeadContract,
} from '@/lib/qualifiedLead/contract';
import { executionStages, COMPOUND_STAGE_NOTE } from '@/lib/qualifiedLead/planCopy';
import { requestImpliesQualifiedLead } from '@/lib/qualifiedLead/routingExpectation';
import {
  cardCriteria, criteriaSectionsOf, criterionPhrase, missionTitle, type CardCriterion,
} from '@/lib/leadMission/missionView';

interface WorkflowConfirmationPayload {
  workflow_id: string;
  workflow_name: string;
  goal: string;
  agent_team: string[];
  inputs: {
    count?: number;
    source?: string;
    industry?: string;
    location?: string;
    persona?: string;
    strictness?: 'strict' | 'flexible';
    output_type?: string;
    url?: string;
    [key: string]: any;
  };
  output: string;
  safety: string;
  estimated_credits: number | null;
  // Company-Brain transparency: the target company profile vs. what's excluded.
  target_company?: string[];
  excluded_company?: string[];
  blocked?: boolean;
  blocked_reason?: string | null;
  setup_needed?: string | null;
  // Lead Intelligence Engine: the structured intent (workflow_type, source_type,
  // role family + aliases/excludes) the backend extracted. Threaded back on Start
  // so the confirmed request is NOT re-classified (which misrouted hiring→people).
  lead_intent?: {
    workflow_type?: string;
    source_type?: string;
    role_family?: string | null;
    role_keywords?: string[];
    exclude_role_keywords?: string[];
    [k: string]: unknown;
  };
  // QUALIFIED-LEAD ROUTE. When present, the preview renders from this structured
  // contract — never from `workflow_name` or a reconstructed command string.
  workflow_kind?: string;
  execution_mode?: string;
  execution_mode_label?: string;
  original_instruction?: string;
  qualified_lead_contract?: QualifiedLeadContract | null;
}

interface Props {
  payload: WorkflowConfirmationPayload;
  conversationId: string | null;
  /** The message that rendered this card — sent with Start so the server can refuse a repeat. */
  messageId?: string | null;
  /**
   * The conversation already holds a Start for this card (`startedCardIds`).
   * Read from the messages, not from this component's state, so a remount can
   * never offer Start again on a card that has already run.
   */
  alreadyStarted?: boolean;
}

// Compact, premium "workflow preview" card. It is NOT a confirmation modal — the
// natural Pilot reply sits above it (message content) and this card is a smooth
// handoff: title, agent team, input chips, output, calm safety note, credits,
// and a primary Start / secondary Edit / subtle Cancel.
export default function WorkflowConfirmationCard({ payload, conversationId, messageId, alreadyStarted }: Props) {
  const tools = useToolAvailability();
  const [isEditing, setIsEditing] = useState(false);
  const [inputs, setInputs] = useState({ ...payload.inputs });
  const [cancelled, setCancelled] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [showRunDetails, setShowRunDetails] = useState(false);

  // Client-side capability backup / sync to live tools state.
  const isFirecrawlMissing = (payload.workflow_id === 'enrich_companies' || payload.workflow_id === 'website_audit') && (!tools.firecrawl?.configured || !tools.firecrawl?.enabled);
  const isApifyPeopleMissing = payload.workflow_id === 'find_decision_makers' && (!tools.apify_people?.configured || !tools.apify_people?.enabled);

  const blocked = payload.blocked || isFirecrawlMissing || isApifyPeopleMissing;
  const setupNeeded = payload.setup_needed || (isFirecrawlMissing ? 'Firecrawl' : isApifyPeopleMissing ? 'People/company employee provider' : null);
  const blockedReason = payload.blocked_reason || (
    isFirecrawlMissing ? 'This workflow needs website scraping before Hawk can run it.'
    : isApifyPeopleMissing ? 'This workflow needs individual people/profile sourcing, which isn\'t set up yet.'
    : null
  );

  // Compact agent-team row: "Scout → Aria" (Pilot is implied, so it's dropped).
  const teamNames = payload.agent_team
    .filter((slug) => slug && slug !== 'pilot')
    .map((slug) => AGENT_BY_ID[slug]?.name || (slug[0].toUpperCase() + slug.slice(1)));

  // Input chips: short, skip empty/null, cap at 5 so the card stays compact.
  const chips = Object.entries(inputs)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => (k === 'count' ? `${v} ${Number(v) === 1 ? 'result' : 'results'}` : String(v)))
    .slice(0, 5);

  // THE MISSION THE BACKEND WILL EXECUTE — not a second reading of the request.
  //
  // Everything below that renders from `mission` is showing the exact object
  // orchestrate persists and run-agent executes. The older strings on this
  // payload stay for pre-mission conversations, and a mismatch between the two
  // is no longer possible for anything that has a mission.
  const missionCandidate = (payload as unknown as { lead_mission?: unknown }).lead_mission;
  const mission: MissionLike | null = isMission(missionCandidate) ? missionCandidate : null;
  const missionDetail = mission ? missionRows(mission) : [];
  const missionSteps = mission ? missionCapabilities(mission) : [];
  const notBroadened = mission ? missionRejectedBroadening(mission) : [];
  const dryRun = mission ? missionDryRun(mission) : null;
  // P1 — hard / target / signals / hypotheses / windows / unprovable, as the
  // backend derived them from this mission.
  const criteria = mission ? criteriaSectionsOf(payload) : null;

  // The qualified-lead route, decided by Pilot from the user's own words.
  const qualifiedLead = isQualifiedLeadPayload(payload);
  const preview = qualifiedLead ? buildWorkflowPreview(payload.qualified_lead_contract) : null;
  const stages = qualifiedLead ? executionStages('qualified_lead_sourcing') : [];

  // DEV-ONLY ROUTING-MISMATCH GUARD.
  //
  // If a correctly-routed backend would have returned a qualified-lead contract
  // and did not, surface the mismatch instead of silently running the legacy
  // account-signal workflow. Gated on DEV so it never blocks end users.
  //
  // The decision moved into `requestImpliesQualifiedLead`, which reads the
  // MISSION rather than scanning the sentence. Scanning matched "Executives" out
  // of "actively hiring … Account Executives" and disabled Start on a company
  // request the Pilot had routed perfectly.
  const originalRequest = String(payload.original_instruction ?? payload.goal ?? '');
  const impliesQualifiedLead = requestImpliesQualifiedLead({ mission, originalRequest });
  const routingMismatch = import.meta.env.DEV && impliesQualifiedLead && !qualifiedLead;

  const handleStart = () => {
    if (blocked || routingMismatch || submitted || alreadyStarted) return;

    // START SENDS THE ORIGINAL REQUEST.
    //
    // This used to send `Run workflow: <generated title>. Count: 5. …`, so the
    // request that actually reached orchestrate was a reconstruction of a title
    // that had already lost the quota, the roles and the discipline. The
    // structured contract now travels in metadata alongside the real sentence.
    const start = buildStartWorkflowPayload(payload, inputs, messageId);

    dispatchChatAction({
      text: start.text,
      conversation_id: conversationId,
      action_source: 'lead_intake_card', // reuse source category to trigger planner
      metadata: {
        ...start.metadata,
        // Legacy actor hint for the account path; the qualified-lead path sets
        // its own inside buildStartWorkflowPayload.
        selected_actor_key: (start.metadata.selected_actor_key as string | undefined)
          ?? (payload.lead_intent?.workflow_type === 'company_hiring_sourcing' ? 'apify_jobs' : undefined),
      },
    });
    setSubmitted(true);
  };


  if (cancelled) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-[13px] text-[#7D8590] italic max-w-[420px]">
        No problem — I'll hold off. Just say the word when you're ready.
      </div>
    );
  }

  if (submitted || alreadyStarted) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3.5 py-2.5 text-[13px] text-emerald-300 flex items-center gap-2 max-w-[420px]">
        <Sparkles className="h-4 w-4 text-emerald-400" />
        {submitted ? `Starting ${payload.workflow_name}…` : `Started ${payload.workflow_name}`}
      </div>
    );
  }

  // ── WHAT THE PERSON SEES FIRST ───────────────────────────────────────────
  //
  // Presentation only. Every value below is read from the payload / mission the
  // backend sent; nothing is re-derived. Criteria come from the backend's own
  // lines (`cardCriteria`), split by the source each line states. The run's
  // machinery (capabilities, the pre-spend check, output) sits one step further
  // in, under "Run details".
  const cc = cardCriteria(criteria);
  const title = preview ? preview.title : missionTitle(mission, payload.workflow_name);
  // The count is the title's; the summary carries the rest of the request.
  const summaryParts: string[] = criteria
    ? [...cc.user, ...cc.added].map(criterionPhrase)
    : mission
      ? missionDetail
        .filter((r) => SUMMARY_KEYS.includes(r.key) && r.value && r.value !== 'any')
        .sort((a, b) => SUMMARY_KEYS.indexOf(a.key) - SUMMARY_KEYS.indexOf(b.key))
        .map((r) => (r.key === 'size' ? `${r.value} employees` : r.value))
      : preview
        ? [preview.target, ...preview.companyConstraints].filter(Boolean)
        : chips;
  // The requested count, as one of the criteria, with its recorded source.
  const countProvenance = mission?.field_provenance?.requested_count ?? null;
  const countLine = mission?.requested_count != null
    ? `${mission.requested_count} ${mission.target_entity === 'company' ? (mission.requested_count === 1 ? 'company' : 'companies') : (mission.requested_count === 1 ? 'result' : 'results')}`
    : null;
  const countIsUsers = countProvenance != null && USER_PROVENANCE.has(countProvenance);
  // Without criteria lines (older cards): the mission rows, by recorded provenance.
  const userRows = missionDetail.filter((r) => r.provenance != null && USER_PROVENANCE.has(r.provenance));
  const addedRows = missionDetail.filter((r) => r.provenance != null && !USER_PROVENANCE.has(r.provenance));
  const otherRows = missionDetail.filter((r) => r.provenance == null);
  // What this run cannot check directly, in plain words.
  const limits = (cc.unsupported.length
    ? cc.unsupported
    : (dryRun?.will_not_establish ?? []).map((g: { requirement: string }) => g.requirement)
  ).map(friendlyGap).filter(Boolean);
  const refused = dryRun?.ok === false;
  const limited = limits.length > 0 && !refused && !blocked;
  const hasRunDetails = missionSteps.length > 0 || !!dryRun || notBroadened.length > 0 || !!preview || !!payload.output;
  const hasAdded = (criteria ? cc.added.length > 0 : addedRows.length > 0) || (!!countLine && !countIsUsers && countProvenance != null)
    || !!payload.target_company?.length;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 max-w-[460px]">
      {routingMismatch && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-200 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-300 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-100">Routing mismatch detected (dev)</div>
            <div className="mt-0.5 text-red-200/90">
              This request requires qualified-lead sourcing, but an account-only workflow was returned.
              Start is disabled to prevent running the legacy path. Check workspace / Claude-first flag / backend routing.
            </div>
          </div>
        </div>
      )}

      {/* Status (the PLAN's — nothing has run or been verified yet), title, one summary line, the team */}
      <div className="flex items-center gap-1.5 text-[11.5px] text-[#8B8F96]">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${blocked ? 'bg-amber-400/80' : refused ? 'bg-[#5C6067]' : 'bg-emerald-400'}`}
        />
        {blocked ? 'Setup needed' : refused ? 'Needs changes' : 'Plan ready · not started'}
      </div>
      {/* The title comes from the CONTRACT for a qualified-lead request, so
          it can never disagree with what will execute. */}
      <h4 className="mt-1.5 text-[16px] font-semibold text-[#F2EFEA] tracking-tight leading-snug">
        {title}
      </h4>
      {summaryParts.length > 0 && !isEditing && (
        <p data-testid="mission-preview" title={summaryParts.join(' · ')} className="mt-1 text-[13px] text-[#A3A7AD] leading-relaxed line-clamp-3">
          {summaryParts.join(' · ')}
        </p>
      )}
      {teamNames.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-[12px] text-[#8B8F96]">
          {teamNames.map((name, idx) => (
            <span key={name} className="flex items-center gap-1">
              {name}
              {idx < teamNames.length - 1 && <ArrowRight className="h-3 w-3 text-[#5C6067]" aria-hidden />}
            </span>
          ))}
        </div>
      )}

      {/* Gated capability — calm, not scary */}
      {blocked && (
        <Notice title={`Setup needed: ${setupNeeded}`}>{blockedReason}</Notice>
      )}

      {/* A requirement this run cannot check directly — said plainly, with a choice. */}
      {limited && (
        <Notice
          title={limits.length === 1 && limits[0].length <= 40
            ? `${capitalize(limits[0])} verification is limited`
            : 'Some criteria can only be partly verified'}
        >
          I can still find likely matches and show the evidence used.
        </Notice>
      )}
      {refused && !blocked && (
        <Notice title="This request can't run as written">
          Nothing will be spent. Edit the criteria, or open them to see why.
        </Notice>
      )}

      {/* Editing the request's inputs */}
      {isEditing && (
        <div className="mt-3 bg-white/[0.02] border border-white/[0.07] rounded-xl p-3 space-y-2.5">
          {Object.keys(inputs).map((key) => {
            if (key === 'strictness') {
              return (
                <div key={key} className="space-y-1">
                  <Label className="text-[11px] text-neutral-400 capitalize">{key}</Label>
                  <Select
                    value={String(inputs[key] ?? 'flexible')}
                    onValueChange={(val) => setInputs((p) => ({ ...p, [key]: val }))}
                  >
                    <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strict" className="text-[12.5px]">Strict</SelectItem>
                      <SelectItem value="flexible" className="text-[12.5px]">Flexible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            }
            const val = inputs[key];
            return (
              <div key={key} className="space-y-1">
                <Label className="text-[11px] text-neutral-400 capitalize">{key.replace(/_/g, ' ')}</Label>
                <Input
                  type={typeof val === 'number' ? 'number' : 'text'}
                  value={val ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setInputs((p) => ({ ...p, [key]: typeof val === 'number' ? (parseInt(v, 10) || 0) : v }));
                  }}
                  className="h-8 text-[12.5px]"
                />
              </div>
            );
          })}
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={() => setIsEditing(false)} className="ag-btn ag-btn-primary rounded-lg font-medium h-7 text-[12px]">
              Apply changes
            </Button>
          </div>
        </div>
      )}

      {/* ── VIEW CRITERIA: what was asked, what was added, what cannot be verified ── */}
      {!isEditing && (
        <div className="mt-3">
          <Disclosure open={showCriteria} onToggle={() => setShowCriteria((v) => !v)} label="criteria" />

          {showCriteria && (
            <div data-testid="mission-criteria" className="mt-2.5 space-y-3 border-t border-white/[0.06] pt-3">
              {criteria ? (
                <>
                  {(cc.user.length > 0 || (countLine && countIsUsers)) && (
                    <CriteriaGroup title="Your criteria">
                      {cc.user.map((c) => <CriterionItem key={c.text} c={c} tone="user" />)}
                      {countLine && countIsUsers && <PlainItem tone="user">{countLine}</PlainItem>}
                    </CriteriaGroup>
                  )}
                  {hasAdded && (
                    <CriteriaGroup title="Agentory added">
                      {cc.added.map((c) => <CriterionItem key={c.text} c={c} tone="added" />)}
                      {countLine && !countIsUsers && countProvenance != null && (
                        <PlainItem tone="added" source={provenanceLabel(countProvenance)}>{countLine}</PlainItem>
                      )}
                      {payload.target_company?.map((t) => (
                        <PlainItem key={`target-${t}`} tone="added" source="from Company Brain">{t}</PlainItem>
                      ))}
                    </CriteriaGroup>
                  )}
                  {cc.considered.length > 0 && (
                    <CriteriaGroup title="Also considered">
                      {cc.considered.map((c) => (
                        <PlainItem key={c.text} tone="added" source={c.section === 'hypotheses' ? 'assumption, never required' : 'ranks only'}>
                          {criterionPhrase(c)}
                        </PlainItem>
                      ))}
                    </CriteriaGroup>
                  )}
                </>
              ) : (
                <>
                  {userRows.length > 0 && (
                    <CriteriaGroup title="Your criteria">
                      {userRows.map((r) => <CriteriaRow key={r.key} row={r} tone="user" />)}
                    </CriteriaGroup>
                  )}
                  {(addedRows.length > 0 || payload.target_company?.length) ? (
                    <CriteriaGroup title="Agentory added">
                      {addedRows.map((r) => <CriteriaRow key={r.key} row={r} tone="added" />)}
                      {payload.target_company?.map((t) => (
                        <PlainItem key={`target-${t}`} tone="added" source="from Company Brain">{t}</PlainItem>
                      ))}
                    </CriteriaGroup>
                  ) : null}
                  {otherRows.length > 0 && (
                    <CriteriaGroup title="Request details">
                      {otherRows.map((r) => <CriteriaRow key={r.key} row={r} tone="added" />)}
                    </CriteriaGroup>
                  )}
                </>
              )}
              {limits.length > 0 && (
                <CriteriaGroup title="Can't verify directly">
                  {limits.map((l) => <PlainItem key={l} tone="limit">{capitalize(l)}</PlainItem>)}
                </CriteriaGroup>
              )}
              {payload.excluded_company?.length ? (
                <CriteriaGroup title="Excluded">
                  {payload.excluded_company.map((t) => (
                    <li key={t} className="text-[12.5px] text-[#8B8F96] line-through decoration-[#8B8F96]/40">{t}</li>
                  ))}
                </CriteriaGroup>
              ) : null}

              {/* ── RUN DETAILS: the machinery, one step further in ───────────── */}
              {hasRunDetails && (
                <div>
                  <Disclosure open={showRunDetails} onToggle={() => setShowRunDetails((v) => !v)} label="run details" quiet />
                  {showRunDetails && (
                    <div className="mt-2.5 space-y-3">
                      {/* QUALIFIED-LEAD PREVIEW — rendered from the structured contract only. */}
                      {preview && (
                        <div className="space-y-2">
                          <PreviewRow label="Hiring roles" items={preview.hiringRoles} tone="neutral" />
                          <PreviewRow label="Decision-makers" items={preview.decisionMakers} tone="neutral" />
                          <PreviewRow label="Company" items={preview.companyConstraints} tone="neutral" />
                          <PreviewRow label="Execution" items={[preview.executionMode]} tone="neutral" />
                          <CriteriaGroup title="Plan" ordered>
                            {stages.map((s, i) => (
                              <li key={s.id} className="text-[12.5px] text-[#A3A7AD] flex gap-1.5">
                                <span className="text-[#6E7278] tabular-nums">{i + 1}.</span>
                                <span>{s.label}</span>
                              </li>
                            ))}
                          </CriteriaGroup>
                          <div className="text-[11.5px] text-[#6E7278]">{COMPOUND_STAGE_NOTE}</div>
                        </div>
                      )}

                      {missionSteps.length > 0 && (
                        <CriteriaGroup title="What will run" testId="mission-capabilities" ordered>
                          {missionSteps.map((label, i) => (
                            <li key={`${label}-${i}`} className="text-[12.5px] text-[#A3A7AD] flex gap-1.5">
                              <span className="text-[#6E7278] tabular-nums">{i + 1}.</span>
                              <span>{label}</span>
                            </li>
                          ))}
                        </CriteriaGroup>
                      )}

                      {dryRun && (
                        <div data-testid="mission-dry-run" className="space-y-1">
                          <div className="text-[11.5px] font-medium text-[#8B8F96]">Before we spend anything</div>
                          <div className="text-[12px] text-[#A3A7AD]">
                            First paid source:{' '}
                            <span data-testid="dry-run-first-provider" className="font-mono text-[11.5px]">
                              {dryRun.first_provider ?? 'none'}
                            </span>
                          </div>
                          <div className="text-[12px] text-[#8B8F96]" data-testid="dry-run-input-summary">
                            Input: {dryRun.input_summary || '(not compiled)'}
                          </div>
                          <div className="text-[12px] text-[#8B8F96]">
                            Estimated cost: {dryRun.estimated_cost_units ?? 0} units ·{' '}
                            {(dryRun.capability_order ?? []).length} capabilities
                          </div>
                          {dryRun.ok === false && (
                            <div data-testid="dry-run-blocked" className="text-[12px] text-amber-200/80">
                              This will be refused before any credits are spent:{' '}
                              {(dryRun.blocked_reasons ?? []).join('; ')}
                            </div>
                          )}

                          {/* ── WHAT THIS RUN PROVES, AND WHAT IT WILL NOT ──────────────
                              The capability list says what will RUN. These say what will be
                              ESTABLISHED — the distinction that let a four-step card for
                              "companies hiring sales roles" prove no hiring at all. */}
                          {(dryRun.proves ?? []).length > 0 && (
                            <div className="text-[12px] text-[#8B8F96]" data-testid="dry-run-proves">
                              Proves:{' '}
                              {(dryRun.proves ?? []).map((p: { requirement: string; by_capability: string }) =>
                                `${p.requirement} (${capabilityLabel(p.by_capability)})`).join(' · ')}
                            </div>
                          )}
                          {(dryRun.will_not_establish ?? []).length > 0 && (
                            <div className="text-[12px] text-amber-200/80" data-testid="dry-run-gaps">
                              Will not establish:{' '}
                              {(dryRun.will_not_establish ?? []).map((g: { requirement: string }) => g.requirement).join(', ')}
                            </div>
                          )}
                          {(dryRun.requires_unlock ?? []).length > 0 && (
                            <div className="text-[12px] text-[#8B8F96]" data-testid="dry-run-unlock">
                              Needs an explicit unlock:{' '}
                              {(dryRun.requires_unlock ?? []).map((u: { requirement: string }) => u.requirement).join(', ')}
                            </div>
                          )}
                        </div>
                      )}

                      {notBroadened.length > 0 && (
                        <div data-testid="mission-not-broadened" className="text-[12px] text-[#8B8F96]">
                          <span className="text-[#A3A7AD]">Not included:</span>{' '}
                          {notBroadened.join('; ')}. Your Company Brain targets these, but you did not ask for
                          them — say so explicitly to widen the search.
                        </div>
                      )}

                      <div className="text-[12px] text-[#8B8F96]">
                        <span className="text-[#A3A7AD]">Output:</span> {preview ? preview.output : payload.output}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Safety + credits — one quiet line */}
      <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[12px] text-[#8B8F96]">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{payload.safety}</span>
        </div>
        {/* A price is shown only when a compiled plan produced one. The
            conversational categories used to print a hardcoded "5" that no
            executable object backed. */}
        {payload.estimated_credits != null ? (
          <span className="shrink-0">~<span className="font-mono text-[#ECE9E4]">{payload.estimated_credits}</span> credits</span>
        ) : (
          <span className="shrink-0 text-[11.5px]" data-testid="no-planned-spend">No planned provider spend</span>
        )}
      </div>

      {/* Actions — the same Start and Edit as always; only the words follow the situation. */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleStart}
          disabled={blocked || routingMismatch}
          className={`ag-btn ag-btn-primary font-medium flex items-center gap-1.5 h-8 px-3.5 rounded-lg ${
            blocked ? 'cursor-not-allowed opacity-45' : ''
          }`}
        >
          <Play className="h-3.5 w-3.5" /> {limited ? 'Continue anyway' : 'Start workflow'}
        </Button>
        {!blocked && !isEditing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="h-8 text-[12.5px] text-[#A3A7AD] hover:text-[#F2EFEA] flex items-center gap-1"
          >
            <Settings2 className="h-3.5 w-3.5" /> {limited || refused ? 'Edit criteria' : 'Edit'}
          </Button>
        )}
        <button
          type="button"
          onClick={() => setCancelled(true)}
          className="ml-auto text-[12px] text-[#6E7278] hover:text-[#A3A7AD] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Summary-line fields, in the order they read naturally. */
const SUMMARY_KEYS = ['known', 'target', 'geo', 'size', 'signal', 'dm'];
/** Provenance codes that mean the person said it. */
const USER_PROVENANCE = new Set(['explicit_user_request', 'workflow_edit']);
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * A gap line in plain words, for display. The backend writes these for itself
 * ("I can't filter on qualifier:round_type in this run", "stage:seed
 * (unsupported)"); the person reads "round type", "seed stage".
 */
function friendlyGap(line: string): string {
  let t = String(line ?? '').trim();
  const filter = t.match(/can['’]t filter on (.+?)(?: in this run)?\.?$/i);
  if (filter) t = filter[1];
  t = t.replace(/\s*\((?:unsupported|unprovable)\)\s*$/i, '');
  const kv = t.match(/^([a-z_]+):\s*(\S.*)$/i);
  if (kv) {
    const [, key, value] = kv;
    const v = value.replace(/_/g, ' ');
    t = /^(qualifier|filter|requirement)$/i.test(key) ? v : `${v} ${key.replace(/_/g, ' ')}`;
  }
  return t.trim();
}

/** A calm notice: one line of title, one line of explanation. */
function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 flex items-start gap-2">
      <Info className="h-3.5 w-3.5 text-amber-300/80 shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[#ECE9E4]">{title}</div>
        {children && <div className="mt-0.5 text-[12.5px] text-[#A3A7AD] leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

/** "View criteria" / "Hide criteria", and the quieter "Run details" inside it. */
function Disclosure({ open, onToggle, label, quiet }: { open: boolean; onToggle: () => void; label: string; quiet?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`inline-flex items-center gap-1 transition-colors ${quiet ? 'text-[11.5px] text-[#8B8F96] hover:text-[#ECE9E4]' : 'text-[12.5px] text-[#A3A7AD] hover:text-[#F2EFEA]'}`}
    >
      {open ? 'Hide' : 'View'} {label}
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
    </button>
  );
}

const BULLET: Record<'user' | 'added' | 'limit', string> = {
  user: 'bg-[#ECE9E4]',
  added: 'border border-[#8B8F96]',
  limit: 'border border-amber-300/70',
};
const ITEM_TEXT: Record<'user' | 'added' | 'limit', string> = {
  user: 'text-[#ECE9E4]',
  added: 'text-[#A3A7AD]',
  limit: 'text-[#A3A7AD]',
};

/** One line in a criteria group: the person's own reads solid; what was added reads softer and says where it came from. */
function PlainItem({ tone, source, note, children }: {
  tone: 'user' | 'added' | 'limit'; source?: string | null; note?: string | null; children: React.ReactNode;
}) {
  return (
    <li className="flex items-baseline gap-2 text-[12.5px]">
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full translate-y-[-1px] ${BULLET[tone]}`} />
      <span className={ITEM_TEXT[tone]}>{children}</span>
      {note && <span className="text-[11px] text-[#6E7278]">{note}</span>}
      {source && <span className="text-[11px] text-[#6E7278]">— {source}</span>}
    </li>
  );
}

/** A backend criterion: its phrase, a "preferred" note for a soft one, a window the backend only defaulted, its source when added. */
function CriterionItem({ c, tone }: { c: CardCriterion; tone: 'user' | 'added' }) {
  const notes = [
    c.section === 'target' || c.required === false ? 'preferred' : null,
    c.window && c.window.source === 'default' ? (c.window.enforced ? 'default window' : 'default window, not yet enforced') : null,
  ].filter(Boolean).join(' · ');
  return (
    <PlainItem tone={tone} source={tone === 'added' ? c.source : null} note={notes || null}>
      {criterionPhrase(c)}
    </PlainItem>
  );
}

function CriteriaGroup({ title, testId, ordered, children }: {
  title: string; testId?: string; ordered?: boolean; children: React.ReactNode;
}) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <div>
      <div className="text-[11.5px] font-medium text-[#8B8F96]">{title}</div>
      <List data-testid={testId} className="mt-1 space-y-1">{children}</List>
    </div>
  );
}

/**
 * One mission field. The person's own criteria read solid; what Agentory added
 * reads softer and says where it came from.
 */
function CriteriaRow({ row, tone }: { row: MissionRow; tone: 'user' | 'added' }) {
  const value = row.key === 'size' ? `${row.value} employees` : row.value;
  const source = tone === 'added' ? provenanceLabel(row.provenance) : null;
  return (
    <li data-testid={`mission-row-${row.key}`} className="flex items-baseline gap-2 text-[12.5px]">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full translate-y-[-1px] ${tone === 'user' ? 'bg-[#ECE9E4]' : 'border border-[#8B8F96]'}`}
      />
      <span className={tone === 'user' ? 'text-[#ECE9E4]' : 'text-[#A3A7AD]'}>{value}</span>
      <span className="text-[11px] text-[#6E7278]">{row.label}</span>
      {source && (
        <span data-testid={`mission-provenance-${row.key}`} className="text-[11px] text-[#6E7278]">— {source}</span>
      )}
    </li>
  );
}

const TONE_CLASS: Record<string, string> = {
  emerald: 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200',
  sky: 'border-sky-500/20 bg-sky-500/[0.06] text-sky-200',
  neutral: 'border-white/[0.07] bg-white/[0.03] text-[#ECE9E4]',
};

/** One labelled chip row of the qualified-lead preview. */
function PreviewRow({ label, items, tone }: { label: string; items: string[]; tone: keyof typeof TONE_CLASS }) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11.5px] font-medium text-[#8B8F96] shrink-0 pt-0.5 w-[104px]">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((t) => (
          <span key={t} className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11.5px] ${TONE_CLASS[tone]}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
