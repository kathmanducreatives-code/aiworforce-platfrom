import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-[background-color,box-shadow] duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[rgb(var(--ag-emerald-ink))] data-[state=checked]:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_14px_-2px_rgb(var(--ag-emerald)/0.5)] data-[state=unchecked]:bg-[var(--ag-fill-active)] data-[state=unchecked]:shadow-[inset_0_0_0_1px_var(--ag-line-strong),inset_0_1px_2px_rgba(0,0,0,0.3)]",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.45)] ring-0 transition-transform duration-200 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-neutral-300"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
