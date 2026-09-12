// WHAT SCRIBE MADE, SHOWN IN ITS OWN SHAPE.
//
// A carousel is slides, a comic is panels, a meme is a setup and a punchline
// over an image — not one paragraph. The Studio shows the structure Scribe
// returned (`contentFormats.ts`), read-only, beside the caption the person
// edits. Visual formats say plainly that this is the plan and the visual brief:
// the renderer that turns slides into an exportable document is future work,
// and a mock-up pretending otherwise would be a promise the product does not
// keep.

import type { ContentArtifact } from "../../../supabase/functions/_shared/contentFormats";
import { FORMAT_SPECS } from "../../../supabase/functions/_shared/contentFormats";

export default function ContentArtifactView({ artifact }: { artifact: ContentArtifact }) {
  const spec = FORMAT_SPECS[artifact.format];
  return (
    <section aria-label={`${spec.label} structure`} className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-muted-foreground/70">{spec.label} · structure</p>
        {spec.renderer === "brief_only" && (
          <span className="ag-badge-outline rounded-md px-1.5 py-0.5 text-[10.5px]">Plan + visual brief · renderer coming</span>
        )}
      </div>
      <div className="mt-2">{body(artifact)}</div>
    </section>
  );
}

function body(a: ContentArtifact) {
  switch (a.format) {
    case "carousel":
      return (
        <ol className="grid gap-2 sm:grid-cols-2">
          <Slide n="Cover" title={a.cover.title} text={a.cover.subtitle} accent />
          {a.slides.map((s, i) => <Slide key={i} n={`${i + 1}`} title={s.title} text={s.body} />)}
          <Slide n="Close" title={a.closing.title} text={[a.closing.body, a.closing.cta].filter(Boolean).join(" · ") || null} />
          <Brief label="Visual direction" text={a.visual_direction} />
        </ol>
      );
    case "comic":
      return (
        <div className="grid gap-2">
          <Note label="Concept" text={a.concept} />
          <ol className="grid gap-2 sm:grid-cols-2">
            {a.panels.map((p, i) => (
              <li key={i} className="ag-glass rounded-xl p-3">
                <p className="text-[11px] font-medium text-muted-foreground/70">Panel {i + 1}</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{p.scene}</p>
                <p className="mt-1.5 text-[13.5px] text-foreground/90">“{p.dialogue}”</p>
              </li>
            ))}
          </ol>
          <Brief label="Visual brief" text={a.visual_brief} />
        </div>
      );
    case "meme":
      return (
        <div className="grid gap-2">
          <Note label="Concept" text={a.concept} />
          <div className="ag-glass grid gap-2 rounded-xl p-3 sm:grid-cols-2">
            <div><p className="text-[11px] font-medium text-muted-foreground/70">Setup</p><p className="mt-1 text-[14px] text-foreground/90">{a.setup}</p></div>
            <div><p className="text-[11px] font-medium text-muted-foreground/70">Punchline</p><p className="mt-1 text-[14px] font-medium text-foreground">{a.punchline}</p></div>
          </div>
          <Brief label="Image brief" text={a.image_brief} />
        </div>
      );
    case "infographic":
      return (
        <div className="grid gap-2">
          <Note label="Title" text={a.title} />
          <div className="grid gap-2 sm:grid-cols-2">
            {a.sections.map((s, i) => (
              <div key={i} className="ag-glass rounded-xl p-3">
                <p className="text-[13px] font-medium text-foreground/90">{s.heading}</p>
                <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted-foreground">
                  {s.points.map((p, j) => <li key={j}>· {p}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <Brief label="Visual brief" text={a.visual_brief} />
        </div>
      );
    case "single_image":
      return (
        <div className="grid gap-2">
          <div className="ag-glass rounded-xl p-3">
            <p className="text-[15px] font-semibold text-foreground">{a.headline}</p>
            {a.supporting_copy && <p className="mt-1 text-[13px] text-muted-foreground">{a.supporting_copy}</p>}
          </div>
          <Brief label="Visual brief" text={a.visual_brief} />
        </div>
      );
    case "quote":
      return (
        <div className="grid gap-2">
          <blockquote className="ag-glass rounded-xl p-4 text-[16px] font-medium leading-snug text-foreground">
            “{a.quote}”{a.attribution && <span className="mt-1 block text-[12.5px] font-normal text-muted-foreground">— {a.attribution}</span>}
          </blockquote>
          <Brief label="Visual brief" text={a.visual_brief} />
        </div>
      );
    case "framework":
      return (
        <ol className="grid gap-2">
          {a.steps.map((s, i) => (
            <li key={i} className="ag-glass flex gap-3 rounded-xl p-3">
              <span className="text-[13px] font-semibold tabular-nums text-emerald-300/90">{i + 1}</span>
              <span><span className="text-[13.5px] font-medium text-foreground/90">{s.title}</span>
                <span className="block text-[12.5px] text-muted-foreground">{s.detail}</span></span>
            </li>
          ))}
        </ol>
      );
    default:
      return null;
  }
}

function Slide({ n, title, text, accent }: { n: string; title: string; text: string | null; accent?: boolean }) {
  return (
    <li className={`ag-glass rounded-xl p-3 ${accent ? "shadow-[inset_2px_0_0_rgb(var(--ag-emerald)/0.8)]" : ""}`}>
      <p className="text-[11px] font-medium text-muted-foreground/70">{n}</p>
      <p className="mt-1 text-[13.5px] font-medium leading-snug text-foreground/95">{title}</p>
      {text && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{text}</p>}
    </li>
  );
}

function Note({ label, text }: { label: string; text: string }) {
  return (
    <p className="text-[13px] text-foreground/85"><span className="text-muted-foreground/70">{label}: </span>{text}</p>
  );
}

function Brief({ label, text }: { label: string; text: string }) {
  return (
    <p className="rounded-lg bg-[var(--ag-fill)] px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground shadow-[inset_0_0_0_1px_var(--ag-line)] sm:col-span-2">
      <span className="font-medium text-foreground/75">{label} · </span>{text}
    </p>
  );
}
