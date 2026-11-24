// The model call for contract v4: ONE structured reading, then deterministic validation.
//
// Uses the existing guarded client (`gptStructured`, strict JSON schema, the routed
// mission-compilation model) and nothing else. The generator is injected so tests and the
// offline study harness never reach the network.

import { gptStructured } from "../gptProvider.ts";
import { routeModel } from "../gptModelRouter.ts";
import { compileContract, ContractInvalidError, type CompiledContractMission } from "./compile.ts";
import { contractHash, type MissionContract } from "./contract.ts";
import { CONTRACT_INSTRUCTION, contractFromProposal, type ContractProposalV4, GPT_CONTRACT_SCHEMA_V4 } from "./interpret.ts";

export const CONTRACT_SYSTEM_PROMPT = [
  "You read a request for B2B leads into a structured mission. You never invent a requirement and never drop one.",
  CONTRACT_INSTRUCTION,
].join("\n");

export type ContractGenerate = (query: string) => Promise<{ ok: true; value: unknown; model: string } | { ok: false; code: string }>;

/** The production generator: the routed mission-compilation model, strict schema. */
export function gptContractGenerate(deps: Parameters<typeof gptStructured>[1] = {}): ContractGenerate {
  return async (query) => {
    const route = routeModel("mission_compilation");
    const r = await gptStructured<Record<string, unknown>>({
      purpose: route.stage, system: CONTRACT_SYSTEM_PROMPT, user: JSON.stringify({ user_query: query }),
      schema: { name: "mission_contract_v4", schema: GPT_CONTRACT_SCHEMA_V4 as unknown as Record<string, unknown> }, model: route.model, reasoningEffort: route.reasoning_effort, tier: route.tier,
      routing_reason: route.reason, temperature: 0, maxTokens: 4000,
    }, deps);
    return r.ok ? { ok: true, value: r.value, model: route.model } : { ok: false, code: String(r.code) };
  };
}

export type ContractInterpretation =
  | { ok: true; contract: MissionContract; mission: CompiledContractMission; hash: string; rejected: { item: string; reason: string }[] }
  | { ok: false; error: string };

/** Request → validated contract → frozen mission. Never falls back to another reading. */
export async function interpretContract(query: string, generate: ContractGenerate): Promise<ContractInterpretation> {
  const g = await generate(query);
  if (!g.ok) return { ok: false, error: g.code };
  try {
    const { contract, rejected } = contractFromProposal(query, g.value as ContractProposalV4, { model: g.model });
    const mission = await compileContract(contract);
    return { ok: true, contract, mission, hash: await contractHash(contract), rejected };
  } catch (e) {
    return { ok: false, error: e instanceof ContractInvalidError ? e.message : `the model's reading could not be validated: ${(e as Error).message}` };
  }
}
