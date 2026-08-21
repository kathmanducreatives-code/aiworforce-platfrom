# Model routing eval

Decides whether a pipeline stage can move to a cheaper model, by scoring what
the model **outputs** rather than what a run happens to deliver.

```bash
deno test --allow-read --allow-env scripts/model-routing-eval/   # 30 tests
deno run  --allow-read --allow-env scripts/model-routing-eval/run.ts
```

Offline. No network, no model, no database.

---

## Why it does not measure lead counts

The obvious eval is to run the pipeline on model A and model B and compare
qualified leads. The persisted history says that measure does not work at any
sample size anyone would pay for.

Two runs, same request, same model, same code, three hours apart — and the
harness proves their compiled missions are **cost-equivalent**, so the input
genuinely did not change:

| run | qualified | identity_unresolved | cost units |
|---|---|---|---|
| `3a231901` | 10 | 5 | 9 |
| `4fe98f5c` | 10 | 12 | 17 |

Same purchase, 2.4× the identity misses, 1.9× the cost. That spread is provider
variance — which Actor rows came back that morning. An A/B at one run per arm
would read the weather and call it a model evaluation.

So the paid end-to-end comparison is the **last** step and needs repeats. This
harness is the cheap step that comes first, and it eliminates candidates for
free.

## Why there is no golden answer

Scoring a candidate by its agreement with gpt-4.1 makes gpt-4.1 the definition
of correct. It is the incumbent, not the definition — the audit caught it
dropping `locations`, and `discoveryScore` catches it proposing a filter the
actor's schema rejects. An eval built on agreement can never discover that the
incumbent is wrong, and rejects a cheaper model for the disagreements that were
improvements.

Hand-written golden missions are worse: they make one person's opinion the
standard while looking objective.

So the scoring is **properties of the output with respect to its own input**:

- `requested_count` equals the number the request states
- `original_user_query` is carried verbatim, not rewritten
- `field_provenance` marks as `explicit_user_request` only things with a textual
  basis in the request
- no `hard_constraint` the request does not support
- `required_signals[].type` is in the canonical vocabulary
- a request naming a signal produces that signal
- a `disallowed_broadening` entry protects a constraint the mission holds

Each is a property a wrong answer **violates**, not merely differs from.

## The three impact grades

`missionImpact.ts` grades every mission field by the paid work a difference
there would change. The grades are traced to call sites, not asserted, and
test 1 reads the real source to keep them honest.

| grade | reaches | a difference here |
|---|---|---|
| `direct` | `buildDiscoveryPlannerPayload` | changes which paid Actors run and what each is asked |
| `gating` | the qualification context | changes how many per-company purchases follow |
| `inert` | prose and explanation surfaces | buys nothing different |

An **untraced** field grades `gating`, never `inert` — a field nobody has traced
is a field nobody has cleared.

The differ compares the way the consumer does. `normalizeCountry` maps `"US"` and
`"United States"` to the same value, so that spelling difference is not reported.
The normalisation list is deliberately narrow and each entry names its consumer.

## The strongest number here

`discoveryScore.ts` runs a proposal through `validateDiscoveryStrategy` — the
same function the live path uses. Whether a proposal is valid has an exact
answer from the actor catalog, with no opinion involved.

The incumbent fails it. Run `4fe98f5c`, harvested verbatim: gpt-4.1 put
`maxItems` on `apify_yc_companies_memo23`, whose schema has no such field. The
validator repaired it — the architecture working — but **a repair is a second
reasoning-tier model call**, and the router's own policy says a repair must
never run on a cheaper model than the attempt that failed.

That makes proposal validity the number that speaks to total system economics: a
model that proposes valid inputs more often costs less than its token price
suggests, and one that proposes them less often costs more.

## The corpus is mostly synthetic, and says so

Phase 3 was planned as "golden fixtures from real persisted missions". The
database does not support that plan. Every mission ever persisted came from one
request:

```
"Find 10 qualified AI startups in the US currently hiring"                  ×12
"Find 2 qualified AI startups in the United States that are currently
 hiring software engineers."                                                 ×1
```

and the chat history contains no other lead request at all. There is no corpus —
there is one sentence, run repeatedly.

So six of seven cases are written here and labelled `synthetic`, each naming the
already-paid-for failure it probes. **A synthetic case can prove a model broken.
It cannot prove one good.** Synthetic cases are listed unscored rather than
scored empty, because an empty score reads as a pass.

If a second real request ever lands, harvest it and shrink the synthetic half.

## Spending money takes two deliberate acts

`--live` alone does nothing. It also needs `--i-authorize-model-spend`, an
`OPENAI_API_KEY`, and an explicit `--model` — the harness never picks a model for
you, because a default model in an eval that compares models is the answer
smuggled into the question.

The live path is **not implemented**. The OpenAI account has no credits, so it
could not be exercised, and shipping an unexercised paid code path is how a
harness lies about a model.
