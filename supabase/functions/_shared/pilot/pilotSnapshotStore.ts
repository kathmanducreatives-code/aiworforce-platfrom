import type { FrozenPilotPacket } from "./pilotContextSnapshot.ts";
import type { PacketScope } from "./pilotEvidencePacket.ts";
export interface SnapshotFence extends PacketScope {
  actor_id: string;
  binding_hash: string;
  enrollment_hash: string;
  brain_hash: string;
  inputs_hash: string;
}
// No production DB implementation. Requires native append-only/scoped constraints,
// current authorization and task/input/version fences in one transaction.
export interface PilotSnapshotStore {
  read(scope: PacketScope): Promise<FrozenPilotPacket | null>;
  // Same task/same exact packet: idempotent return. Different packet: conflict.
  // Never upsert, recompile or replace an existing task snapshot on retry.
  insertOnce(
    packet: FrozenPilotPacket,
    fence: SnapshotFence,
  ): Promise<FrozenPilotPacket>;
}
