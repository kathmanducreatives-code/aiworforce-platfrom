// A SIGNAL CARD THAT SENDS TO PILOT SENDS THE SIGNAL, NOT JUST ITS TITLE.
//
// "Turn into post" on the Signals page dispatches to Pilot. It used to dispatch
// an English sentence and nothing else, so the draft Pilot made could never
// carry `source_signal_id` — the model would
// have had to guess which signal a title meant. The id now travels in the action
// metadata, and this file fails if any Pilot-bound signal action stops sending it.
//
// ZERO network, ZERO database, ZERO models. Source text only.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = new URL("../../src/", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, SRC));

/** Every `src/` file that builds a turn-into command for Pilot. */
async function turnIntoCallers(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: URL, rel: string) {
    for await (const e of Deno.readDir(dir)) {
      const childRel = rel + e.name;
      if (e.isDirectory) await walk(new URL(e.name + "/", dir), childRel + "/");
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && !childRel.endsWith("lib/signalIdeaActions.ts")) {
        const text = await Deno.readTextFile(new URL(e.name, dir));
        if (/buildTurnIntoCommand\(/.test(text.replace(/\/\/.*$/gm, ""))) out.push(childRel);
      }
    }
  }
  await walk(SRC, "");
  return out;
}

Deno.test("every Pilot-bound 'turn signal into' action carries the signal id as metadata", async () => {
  const callers = await turnIntoCallers();
  assert(callers.length >= 1, `expected at least the Signals feed drawer, found ${callers.join(", ")}`);
  for (const rel of callers) {
    const code = (await read(rel)).replace(/\/\/.*$/gm, "");
    const commands = code.split("buildTurnIntoCommand(").length - 1;
    const metadata = code.split("metadata: buildTurnIntoMetadata(").length - 1;
    assert(metadata >= commands,
      `${rel}: ${commands} turn-into command(s) but ${metadata} carry the signal id — ` +
      "a title in a sentence cannot become a real source_signal_id");
  }
});

Deno.test("the metadata names the signal by id, never by title", async () => {
  const code = await read("lib/signalIdeaActions.ts");
  const i = code.indexOf("export function buildTurnIntoMetadata");
  assert(i > 0);
  const body = code.slice(i, code.indexOf("\n}", i));
  assert(body.includes("signal_id: signal.id"));
  assert(!/title/.test(body.split("{").slice(2).join("{")), "the metadata must not carry a title as identity");
});
