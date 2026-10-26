import { withBuildStamp } from "../_shared/buildStamp.ts";
import { handlePilotImport } from "../_shared/pilot/pilotImport.ts";
Deno.serve(withBuildStamp((req) => handlePilotImport(req)));
