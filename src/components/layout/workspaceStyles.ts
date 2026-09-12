// THE DESIGN SYSTEM, FOR HAND-BUILT CONTROLS.
//
// Where a page builds its own element instead of using a components/ui
// primitive, it uses these — which are the same `.ag-*` classes the primitives
// are made of (index.css, "AGENTORY DESIGN SYSTEM"). A hand-built primary is the
// same object as <Button>, a glass card the same as <Card>. Nothing here defines
// a colour of its own.

const DISABLED = "disabled:cursor-not-allowed disabled:opacity-45";

/** A glass panel: filter bars, strips, rails-within-the-page. */
export const GLASS_PANEL = "ag-glass";

/** A raised glass surface: popovers, the one featured card on a view. */
export const GLASS_RAISED = "ag-raised";

/** A list card — flat glass that lifts its hairline and takes a trace of the room light on hover. */
export const GLASS_CARD = "ag-glass ag-interactive rounded-xl";

/** The one selected row/card in a list: lit from its leading edge. */
export const SELECTED = "ag-selected";

/** The one primary action on a view (same as <Button>). */
export const PRIMARY_ACTION = `ag-btn ag-btn-primary font-medium ${DISABLED}`;

/** Secondary actions: quiet glass, neutral text (same as <Button variant="outline">). */
export const SECONDARY_ACTION = `ag-btn ag-btn-secondary font-medium ${DISABLED}`;

/** Ghost: text until hovered (same as <Button variant="ghost">). */
export const GHOST_ACTION = `ag-btn ag-btn-ghost font-medium ${DISABLED}`;

/** Inputs and selects (same as <Input>). */
export const GLASS_INPUT = "ag-field text-foreground placeholder:text-muted-foreground/55";

/** A filter/toggle chip; mark the on state with aria-pressed. */
export const GLASS_CHIP = "ag-chip";

/** Segmented view switcher; items take aria-selected / aria-pressed / data-active. */
export const SEGMENTED = "ag-segmented";
export const SEGMENT = "ag-seg-item";

/** Metric strip — the Leads MetricStrip: glass, divided cells, tracked labels. */
export const METRIC_STRIP = "ag-glass flex items-stretch overflow-hidden rounded-xl";
export const METRIC_LABEL = "text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
export const METRIC_VALUE = "text-[20px] font-semibold leading-none tabular-nums text-foreground";

/** The empty-state mark: an object in the room light. Size it at the call site. */
export const EMPTY_MARK = "ag-empty-mark";
