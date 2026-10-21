import { withBuildStamp } from "../_shared/buildStamp.ts";
import { handlePilotContext } from "../_shared/pilot/pilotContext.ts";
Deno.serve(withBuildStamp((req) => handlePilotContext(req)));
