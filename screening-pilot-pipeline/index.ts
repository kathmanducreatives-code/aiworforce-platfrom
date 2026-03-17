import { getEnv } from "./utils/env.js";
import { runPipeline } from "./stages/8-orchestrator.js";

async function main() {
  const env = getEnv();
  await runPipeline(env);
}

main().catch(error => {
  console.error("❌ Pipeline failed:", error);
  process.exit(1);
});
