// Thin UI wrapper over the chat command bus. Components call this instead of
// dispatching a raw `chat:send` event so that (a) the chat opens/mounts if it is
// closed, and (b) the success toast only fires once Pilot actually received the
// command. On failure it shows an honest error instead of a fake success.
import { toast } from "sonner";
import { dispatchAgentCommand } from "./chatCommandBus";

export interface SendAgentCommandOptions {
  /** Toast shown only after a mounted listener accepts the command. */
  success?: string;
  action_source?: string;
  conversation_id?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Send a natural-language command to Pilot. Returns true when delivered.
 * Never toasts success for a command that wasn't received.
 */
export async function sendAgentCommand(
  text: string,
  opts: SendAgentCommandOptions = {},
): Promise<boolean> {
  const ok = await dispatchAgentCommand({
    text,
    conversation_id: opts.conversation_id ?? null,
    action_source: opts.action_source,
    metadata: opts.metadata,
  });
  if (ok) {
    if (opts.success) toast.success(opts.success);
  } else {
    toast.error("Couldn't reach Pilot. Open the chat and try again.");
  }
  return ok;
}
