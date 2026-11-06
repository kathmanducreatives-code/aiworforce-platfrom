// PRODUCTION CHAT × MISSION CONTRACT — the two decisions pilot-chat delegates here.
//
//   `contractForCard`  — when a lead request is about to be shown as an approval card:
//       flags off (production today): the v1 mission, unchanged, plus its contract binding
//                         (metadata only; zero model calls).
//       shadow:           the v4 contract is interpreted BESIDE v1 and compared; the card,
//                         the mission and the run stay v1. The shadow is never executed and
//                         cannot reach a provider: it returns metadata, never a mission.
//       v4:               the card's mission IS the v4 contract (Brain applied before
//                         approval), compiled and frozen. A model failure, an open question
//                         or an unapprovable contract is answered honestly; v1 is NOT used
//                         as a fallback reading.
//   `checkStart`       — when a confirmed Start arrives: does the mission it carries reproduce
//                         the card's stored contract hash? Logged always; refused only when
//                         `AGENTORY_CHAT_CONTRACT_BINDING=enforce`. Cards stored before binding
//                         existed run exactly as before.
//
// Every failure in shadow or binding bookkeeping is swallowed into metadata: neither can
// break or change a v1 conversation.

import { applyCompanyBrain, type ContractBrainInput, type ContractBrainReport } from "./brain.ts";
import { contractFromMission } from "./boundary.ts";
import {
  bindingDecision, type BindingVerdict, type ChatContractFlags, compareContracts, type ContractBinding, contractBindingOf,
  type ContractComparison, ContractNotExecutableError, missionFromContract, verifyApprovalBinding,
} from "./chatMission.ts";
import { approvability, disclosures } from "./contract.ts";
import { type ContractGenerate, interpretContract } from "./gptInterpreter.ts";

export interface CardContractMetadata {
  mission_contract_binding: ContractBinding | { error: string };
  mission_contract_shadow?: ContractComparison | { error: string };
  mission_contract_brain?: ContractBrainReport;
  mission_contract_disclosures?: { requirementId: string; label: string }[];
  mission_contract_assumptions?: { requirementId: string; policy: string; text: string }[];
}

export type CardDecision =
  | { kind: "mission"; mission: unknown; source: "v1" | "v4"; metadata: CardContractMetadata }
  | { kind: "ask"; questions: string[]; metadata: Partial<CardContractMetadata> }
  | { kind: "refuse"; reason: "interpretation_failed" | "not_approvable"; detail: string[]; metadata: Partial<CardContractMetadata> };

const SHADOW_TIMEOUT_MS = 20_000;

async function bindingOrError(mission: unknown): Promise<ContractBinding | { error: string }> {
  try { return await contractBindingOf(mission); } catch (e) { return { error: (e as Error).message.slice(0, 200) }; }
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((res) => { t = setTimeout(() => res(onTimeout), ms); })]).finally(() => clearTimeout(t));
}

export async function contractForCard(i: {
  message: string; v1Mission: unknown; flags: ChatContractFlags; generate: ContractGenerate | null; brain: ContractBrainInput | null;
}): Promise<CardDecision> {
  if (!i.flags.v4 && !i.flags.shadow) {
    return { kind: "mission", mission: i.v1Mission, source: "v1", metadata: { mission_contract_binding: await bindingOrError(i.v1Mission) } };
  }
  const interpreted = i.generate
    ? await withTimeout(interpretContract(i.message, i.generate).catch((e) => ({ ok: false as const, error: (e as Error).message })), SHADOW_TIMEOUT_MS,
      { ok: false as const, error: "timeout" })
    : { ok: false as const, error: "no_generator" };

  // ── Shadow only: compare, record, change nothing ──
  if (!i.flags.v4) {
    const metadata: CardContractMetadata = { mission_contract_binding: await bindingOrError(i.v1Mission) };
    if (!interpreted.ok) metadata.mission_contract_shadow = { error: interpreted.error.slice(0, 200) };
    else {
      try {
        const baseline = contractFromMission(i.v1Mission as never);
        const { contract } = applyCompanyBrain(interpreted.contract, i.brain);
        metadata.mission_contract_shadow = await compareContracts(baseline.ok ? baseline.contract : null, contract);
      } catch (e) { metadata.mission_contract_shadow = { error: (e as Error).message.slice(0, 200) }; }
    }
    return { kind: "mission", mission: i.v1Mission, source: "v1", metadata };
  }

  // ── v4: the contract drives the card ──
  if (!interpreted.ok) return { kind: "refuse", reason: "interpretation_failed", detail: [interpreted.error.slice(0, 200)], metadata: {} };
  if (interpreted.contract.ambiguities.length) {
    return { kind: "ask", questions: interpreted.contract.ambiguities.map((a) => a.question), metadata: {} };
  }
  const { contract, report } = applyCompanyBrain(interpreted.contract, i.brain);
  if (contract.ambiguities.length) {
    // A Company Brain rule that conflicts with the request: the user decides.
    return { kind: "ask", questions: contract.ambiguities.map((a) => a.question), metadata: { mission_contract_brain: report } };
  }
  const ok = approvability(contract);
  if (!ok.ok) return { kind: "refuse", reason: "not_approvable", detail: ok.reasons, metadata: { mission_contract_brain: report } };
  let mission;
  try { mission = await missionFromContract(contract); } catch (e) {
    if (e instanceof ContractNotExecutableError) return { kind: "refuse", reason: "not_approvable", detail: e.reasons, metadata: { mission_contract_brain: report } };
    throw e;
  }
  const metadata: CardContractMetadata = {
    mission_contract_binding: await bindingOrError(mission),
    mission_contract_brain: report,
    mission_contract_disclosures: disclosures(contract).map((r) => ({ requirementId: r.id, label: r.display.label })),
    mission_contract_assumptions: contract.assumptions,
  };
  try {
    const baseline = contractFromMission(i.v1Mission as never);
    metadata.mission_contract_shadow = await compareContracts(baseline.ok ? baseline.contract : null, contract);
  } catch (e) { metadata.mission_contract_shadow = { error: (e as Error).message.slice(0, 200) }; }
  return { kind: "mission", mission, source: "v4", metadata };
}

/**
 * A confirmed Start: compare the mission it carries with the binding stored on the card's
 * own message row. `cardMetadata` must come from the database row, never the request.
 */
export async function checkStart(i: { started: unknown; cardMetadata: unknown; flags: ChatContractFlags }): Promise<{ decision: "run" | "refuse"; verdict: BindingVerdict }> {
  let verdict: BindingVerdict;
  try {
    const stored = (i.cardMetadata as { mission_contract_binding?: unknown } | null)?.mission_contract_binding;
    verdict = await verifyApprovalBinding(i.started, stored);
  } catch {
    verdict = { status: "unconvertible" };
  }
  // A v4 mission exists only on a bound card (bindings predate v4): one that arrives
  // without a verifiable card is not historical, it is unverified.
  const isV4 = !!(i.started as { mission_contract?: unknown } | null)?.mission_contract;
  if (isV4 && (verdict.status === "unbound" || verdict.status === "unconvertible")) {
    verdict = { status: "mismatch", approved: "(no verifiable card)", started: null };
  }
  return { decision: bindingDecision(verdict, i.flags), verdict };
}
