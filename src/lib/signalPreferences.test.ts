import { describe, it, expect } from "vitest";
import { defaultsFromBrain, mergePreferences, totalSignalsInMix, DEFAULT_MIX, emptyPreferences, readPreferencesFromBrainProfile } from "./signalPreferences";

describe("signalPreferences", () => {
  it("default mix totals 10", () => {
    expect(totalSignalsInMix(DEFAULT_MIX)).toBe(10);
  });

  it("defaultsFromBrain seeds from ICP", () => {
    const p = defaultsFromBrain({
      icp: { industries: ["SaaS"], buyer_roles: ["CEO"], geography: "US", pain_points: ["pain"], disqualifiers: ["x"] },
      competitors: { known: ["A"], adjacent: ["B"], unknown: false },
    } as any);
    expect(p.industries).toEqual(["SaaS"]);
    expect(p.hiring_roles).toEqual(["CEO"]);
    expect(p.competitors).toEqual(["A", "B"]);
    expect(p.geographies).toEqual(["US"]);
    expect(p.disqualifiers).toEqual(["x"]);
  });

  it("stored prefs override defaults", () => {
    const merged = mergePreferences(
      { icp: { industries: ["SaaS"], buyer_roles: ["CEO"] } } as any,
      { industries: ["Fintech"], default_mix: { hiring: 5 } as any },
    );
    expect(merged.industries).toEqual(["Fintech"]);
    expect(merged.default_mix.hiring).toBe(5);
    expect(merged.default_mix.linkedin_intent).toBe(DEFAULT_MIX.linkedin_intent);
  });

  it("readPreferencesFromBrainProfile handles missing field", () => {
    expect(readPreferencesFromBrainProfile(null)).toBeNull();
    expect(readPreferencesFromBrainProfile({})).toBeNull();
    expect(readPreferencesFromBrainProfile({ signal_preferences: { keywords: ["a"] } })).toEqual({ keywords: ["a"] });
  });

  it("empty preferences are stable", () => {
    const a = emptyPreferences();
    const b = emptyPreferences();
    expect(a).toEqual(b);
    expect(totalSignalsInMix(a.default_mix)).toBe(10);
  });
});
