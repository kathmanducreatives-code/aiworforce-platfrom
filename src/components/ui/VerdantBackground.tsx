import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VerdantBackgroundProps {
    mode?: "mesh" | "spotlight";
    className?: string;
}

const noiseUrl = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`;

export const VerdantBackground = ({ mode = "mesh", className }: VerdantBackgroundProps) => {
    if (mode === "spotlight") {
        return (
            <div className={cn("fixed inset-0 -z-50 overflow-hidden bg-white", className)}>
                {/* Core spotlight - Primary Green, top-center bias */}
                <motion.div
                    animate={{
                        scale: [1, 1.08, 1],
                        opacity: [0.2, 0.15, 0.2],
                    }}
                    transition={{
                        duration: 12,
                        repeat: Infinity,
                        ease: "easeInOut",
                    }}
                    className="absolute left-1/2 top-[20%] -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-[#059467] blur-[120px]"
                />

                {/* Mid-ring - Accent Teal, offset timing */}
                <motion.div
                    animate={{
                        scale: [1.05, 1, 1.05],
                        opacity: [0.12, 0.08, 0.12],
                    }}
                    transition={{
                        duration: 14,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: 2,
                    }}
                    className="absolute left-1/2 top-[25%] -translate-x-1/2 w-[1000px] h-[1000px] rounded-full bg-[#14b8a5] blur-[150px]"
                />

                {/* Edge glow - Light Mint radial */}
                <div
                    className="absolute inset-0"
                    style={{
                        background: "radial-gradient(ellipse at 50% 30%, rgba(237,253,249,0.05) 0%, transparent 70%)",
                    }}
                />
                <div className="absolute inset-0 bg-gradient-to-br from-[#edfdf9]/30 via-transparent to-[#edfdf9]/30" />

                {/* Noise overlay */}
                <div className="absolute inset-0 opacity-[0.025] pointer-events-none" style={{ backgroundImage: noiseUrl }} />
            </div>
        );
    }

    // Default "mesh" mode — multi-point gradient mesh morphing over 10s
    return (
        <div className={cn("fixed inset-0 -z-50 overflow-hidden bg-white/50", className)}>
            {/* Primary mesh layer */}
            <motion.div
                animate={{
                    background: [
                        "radial-gradient(circle at 10% 20%, rgba(5,148,103,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(20,184,165,0.10) 0%, transparent 50%)",
                        "radial-gradient(circle at 60% 80%, rgba(5,148,103,0.15) 0%, transparent 50%), radial-gradient(circle at 20% 30%, rgba(20,184,165,0.10) 0%, transparent 50%)",
                        "radial-gradient(circle at 90% 30%, rgba(5,148,103,0.15) 0%, transparent 50%), radial-gradient(circle at 40% 60%, rgba(20,184,165,0.10) 0%, transparent 50%)",
                        "radial-gradient(circle at 10% 20%, rgba(5,148,103,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(20,184,165,0.10) 0%, transparent 50%)",
                    ]
                }}
                transition={{
                    duration: 10,
                    repeat: Infinity,
                    ease: "linear",
                }}
                className="absolute inset-0 w-full h-full"
            />

            {/* Secondary subtle layer */}
            <motion.div
                animate={{
                    background: [
                        "radial-gradient(circle at 70% 20%, rgba(232,252,243,0.05) 0%, transparent 60%)",
                        "radial-gradient(circle at 30% 70%, rgba(232,252,243,0.05) 0%, transparent 60%)",
                        "radial-gradient(circle at 70% 20%, rgba(232,252,243,0.05) 0%, transparent 60%)",
                    ]
                }}
                transition={{
                    duration: 12,
                    repeat: Infinity,
                    ease: "linear",
                }}
                className="absolute inset-0 w-full h-full"
            />

            {/* Floating orb 1 */}
            <motion.div
                animate={{
                    x: [0, 100, 0],
                    y: [0, -50, 0],
                    opacity: [0.05, 0.15, 0.05],
                }}
                transition={{
                    duration: 10,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
                className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#14b8a5] rounded-full blur-[128px] mix-blend-multiply"
            />

            {/* Floating orb 2 */}
            <motion.div
                animate={{
                    x: [0, -70, 0],
                    y: [0, 60, 0],
                    opacity: [0.05, 0.12, 0.05],
                }}
                transition={{
                    duration: 14,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 1.5,
                }}
                className="absolute bottom-1/3 right-1/4 w-[500px] h-[500px] bg-[#059467] rounded-full blur-[140px] mix-blend-multiply"
            />

            {/* Noise overlay */}
            <div className="absolute inset-0 opacity-[0.025] pointer-events-none" style={{ backgroundImage: noiseUrl }} />
        </div>
    );
};
