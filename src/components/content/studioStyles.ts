// THE CONTENT PAGE WEARS THE AGENTORY DESIGN SYSTEM — IT DOES NOT HAVE ITS OWN.
//
// Actions, surfaces, rows and fields are the shared `.ag-*` classes (via
// workspaceStyles); the accent is the Growth department's emerald. Nothing here
// defines a colour of its own.

import { getDeptTheme } from "@/lib/departmentTheme";
import { PRIMARY_ACTION, SECONDARY_ACTION, SELECTED } from "@/components/layout/workspaceStyles";

export const ACCENT = getDeptTheme("growth");

export const PRIMARY_BUTTON = PRIMARY_ACTION;
export const SECONDARY_BUTTON = SECONDARY_ACTION;

/** A list row at rest (a quiet fill on hover), and the one selected. */
export const ROW_IDLE = "border-transparent hover:bg-[var(--ag-fill)]";
export const ROW_SELECTED = SELECTED;

/** A field wrapper (input + button inside): the shared well, focus ring on focus-within. */
export const FIELD = "ag-field";
