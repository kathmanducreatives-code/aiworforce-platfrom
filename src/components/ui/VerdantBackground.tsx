import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VerdantBackgroundProps {
    mode?: "mesh" | "spotlight";
    className?: string;
}

export const VerdantBackground = ({ mode = "mesh", className }: VerdantBackgroundProps) => {
    if (mode === "spotlight") {
        return (
            <div className={cn("fixed inset-0 -z-50 overflow-hidden bg-white", className)}>
                {/* Core spotlight - Primary Green */}
                <motion.div
                    animate={{
                        scale: [1, 1.1, 1],
                        opacity: [0.2, 0.15, 0.2],
                    }}
                    transition={{
                        duration: 12,
                        repeat: Infinity,
                        ease: "easeInOut",
                    }}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[#059467] blur-[120px]"
                />

                {/* Mid spotlight - Accent Teal */}
                <motion.div
                    animate={{
                        scale: [1.1, 1, 1.1],
                        opacity: [0.12, 0.08, 0.12],
                    }}
                    transition={{
                        duration: 15,
                        repeat: Infinity,
                        ease: "easeInOut",
                    }}
                    className="absolute left-1/3 top-1/3 w-[600px] h-[600px] rounded-full bg-[#14b8a5] blur-[100px]"
                />

                {/* Edge glow - Light Mint */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#edfdf9]/40 via-transparent to-[#edfdf9]/40" />

                {/* Noise overlay */}
                <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
                }} />
            </div>
        );
    }

    // Default "mesh" mode
    return (
        <div className={cn("fixed inset-0 -z-50 overflow-hidden bg-white/50", className)}>
            <motion.div
                animate={{
                    background: [
                        "radial-gradient(circle at 10% 20%, rgba(5, 148, 103, 0.15) 0%, rgba(20, 184, 165, 0.05) 50%, rgba(232, 252, 243, 0.1) 100%)",
                        "radial-gradient(circle at 90% 80%, rgba(5, 148, 103, 0.15) 0%, rgba(20, 184, 165, 0.05) 50%, rgba(232, 252, 243, 0.1) 100%)",
                        "radial-gradient(circle at 50% 50%, rgba(5, 148, 103, 0.15) 0%, rgba(20, 184, 165, 0.05) 50%, rgba(232, 252, 243, 0.1) 100%)",
                        "radial-gradient(circle at 10% 20%, rgba(5, 148, 103, 0.15) 0%, rgba(20, 184, 165, 0.05) 50%, rgba(232, 252, 243, 0.1) 100%)",
                    ]
                }}
                transition={{
                    duration: 20,
                    repeat: Infinity,
                    ease: "linear",
                }}
                className="absolute inset-0 w-full h-full"
            />

            {/* Subtle floating orb 1 */}
            <motion.div
                animate={{
                    x: [0, 100, 0],
                    y: [0, -50, 0],
                    opacity: [0.1, 0.2, 0.1],
                }}
                transition={{
                    duration: 10,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
                className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#14b8a5] rounded-full blur-[128px] mix-blend-multiply"
            />

            {/* Subtle floating orb 2 */}
            <motion.div
                animate={{
                    x: [0, -70, 0],
                    y: [0, 60, 0],
                    opacity: [0.1, 0.15, 0.1],
                }}
                transition={{
                    duration: 14,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 1.5,
                }}
                className="absolute bottom-1/3 right-1/4 w-[500px] h-[500px] bg-[#059467] rounded-full blur-[140px] mix-blend-multiply"
            />

            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
            }} />
        </div>
    );
};
