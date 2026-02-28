import React, { useRef, useState, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GyroTiltProps {
    children: ReactNode;
    className?: string;
    contentClassName?: string;
    intensity?: number;
}

export function GyroTilt({ children, className, contentClassName, intensity = 15 }: GyroTiltProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [rotation, setRotation] = useState({ x: 0, y: 0 });
    const [glarePosition, setGlarePosition] = useState({ x: 50, y: 50 });
    const [isHovered, setIsHovered] = useState(false);

    const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();

        // Normalized coordinates (-1 to 1)
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;

        setRotation({
            x: -y * intensity,
            y: x * intensity,
        });

        // Glare position (0% to 100%)
        setGlarePosition({
            x: ((x + 1) / 2) * 100,
            y: ((y + 1) / 2) * 100,
        });
    };

    const handleMouseEnter = () => setIsHovered(true);

    const handleMouseLeave = () => {
        setIsHovered(false);
        setRotation({ x: 0, y: 0 });
        setGlarePosition({ x: 50, y: 50 });
    };

    return (
        <div
            ref={containerRef}
            className={cn("group relative transition-all duration-300 ease-out", className)}
            style={{ perspective: "1000px" }}
            onMouseMove={handleMouseMove}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div
                className={cn(
                    "w-full h-full relative transition-[transform,box-shadow] duration-200 ease-out filter will-change-transform",
                    contentClassName
                )}
                style={{
                    transform: isHovered
                        ? `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`
                        : "rotateX(0deg) rotateY(0deg)",
                    boxShadow: isHovered
                        ? `${-rotation.y * 1.5}px ${rotation.x * 1.5}px 40px rgba(0, 0, 0, 0.4)`
                        : "0px 10px 30px rgba(0, 0, 0, 0.2)",
                }}
            >
                {children}

                {/* Specular Glare/Shimmer */}
                <div
                    className="pointer-events-none absolute inset-0 z-50 rounded-[inherit] transition-opacity duration-300 ease-out flex"
                    style={{
                        opacity: isHovered ? 0.4 : 0,
                        background: `radial-gradient(circle at ${glarePosition.x}% ${glarePosition.y}%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 60%)`,
                    }}
                />
            </div>
        </div>
    );
}
