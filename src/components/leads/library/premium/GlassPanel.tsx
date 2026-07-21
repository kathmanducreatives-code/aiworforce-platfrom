import { forwardRef, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { edgeHighlight, glassActive, glassSurface, glassSurfaceRaised } from "./tokens";

interface Props extends HTMLAttributes<HTMLDivElement> {
  raised?: boolean;
  active?: boolean;
  padded?: boolean;
}

export const GlassPanel = forwardRef<HTMLDivElement, Props>(function GlassPanel(
  { className, raised, active, padded, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl overflow-hidden",
        raised ? glassSurfaceRaised : glassSurface,
        edgeHighlight,
        active && glassActive,
        padded && "p-5",
        className,
      )}
      {...rest}
    >
      <div className="relative z-[1]">{children}</div>
    </div>
  );
});
