import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

interface GradientSliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
    min?: number;
    max?: number;
    step?: number;
    markers?: boolean;
    customMarkers?: number[];
}

const GradientSlider = React.forwardRef<
    React.ElementRef<typeof SliderPrimitive.Root>,
    GradientSliderProps
>(({ className, min = 0, max = 100, step = 1, markers = true, customMarkers, ...props }, ref) => {
    const [value, setValue] = React.useState(props.defaultValue || props.value || [0]);

    // Keep internal state in sync with controlled value if provided
    React.useEffect(() => {
        if (props.value) setValue(props.value);
    }, [props.value]);

    const handleValueChange = (newVal: number[]) => {
        setValue(newVal);
        props.onValueChange?.(newVal);
    };

    const percentage = ((value[0] - min) / (max - min)) * 100;

    // Generate milestone markers
    const milestoneMarkers = customMarkers
        ? customMarkers.filter(v => v >= min && v <= max)
        : Array.from({ length: Math.floor((max - min) / 10) + 1 }, (_, i) => min + i * 10).filter(v => v >= min && v <= max);

    return (
        <SliderPrimitive.Root
            ref={ref}
            min={min}
            max={max}
            step={step}
            className={cn(
                "relative flex w-full touch-none select-none items-center pt-8 pb-6",
                className
            )}
            {...props}
            onValueChange={handleValueChange}
        >
            <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted">
                <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-emerald-500 to-teal-500" />
            </SliderPrimitive.Track>

            {/* Thumb with Tooltip */}
            <SliderPrimitive.Thumb className="relative block h-4 w-4 rounded-full border-[1.5px] border-emerald-600 bg-white ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:scale-125 duration-200 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                <div
                    className="absolute -top-8 left-1/2 -translate-x-1/2 bg-card border border-border text-foreground font-medium text-[10px] px-2 py-0.5 rounded-md shadow-xl transition-all whitespace-nowrap"
                    style={{ transform: `translateX(-50%)` }}
                >
                    {value[0]}
                </div>
            </SliderPrimitive.Thumb>

            {/* Markers */}
            {markers && (
                <div className="absolute bottom-0 left-0 w-full h-4 flex justify-between px-1 text-[9px] text-muted-foreground/40 font-medium select-none pointer-events-none">
                    {milestoneMarkers.map((m) => {
                        const pos = ((m - min) / (max - min)) * 100;
                        return (
                            <div key={m} className="absolute flex flex-col items-center gap-1.5" style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}>
                                <div className={cn("w-px h-1 transition-colors", m <= value[0] ? "bg-emerald-500/50" : "bg-white/5")} />
                                <span>{m}</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </SliderPrimitive.Root>
    )
})
GradientSlider.displayName = "GradientSlider"

export { GradientSlider }
