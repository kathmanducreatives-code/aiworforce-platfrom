// Absolute page backdrop for the Lead Library command surface.
// Renders a deep-black gradient, subtle grid, and a single emerald glow.
// The light itself now lives in AmbientBackdrop, shared with Signals and Content.
import { AmbientBackdrop } from "@/components/layout/AmbientBackdrop";

export function CommandBackdrop() {
  return <AmbientBackdrop variant="leads" />;
}
