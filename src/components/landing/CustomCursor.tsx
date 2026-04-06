import { useEffect } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

const CustomCursor = () => {
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    const springConfig = { damping: 25, stiffness: 150, mass: 0.5 };
    const cursorX = useSpring(mouseX, springConfig);
    const cursorY = useSpring(mouseY, springConfig);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            mouseX.set(e.clientX - 10);
            mouseY.set(e.clientY - 10);
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [mouseX, mouseY]);

    return (
        <>
            {/* The primary cursor dot */}
            <motion.div
                className="fixed top-0 left-0 w-5 h-5 bg-accent-mint rounded-full pointer-events-none z-[9999] mix-blend-screen"
                style={{
                    x: cursorX,
                    y: cursorY,
                    boxShadow: '0 0 20px rgba(16, 185, 129, 0.8), 0 0 40px rgba(16, 185, 129, 0.4)'
                }}
            />
            {/* The large trailing glow */}
            <motion.div
                className="fixed top-0 left-0 w-[400px] h-[400px] rounded-full pointer-events-none z-[9998] opacity-20"
                style={{
                    x: cursorX,
                    y: cursorY,
                    translateX: '-47.5%',
                    translateY: '-47.5%',
                    background: 'radial-gradient(circle, rgba(16, 185, 129, 0.4) 0%, transparent 70%)',
                    filter: 'blur(40px)'
                }}
            />
        </>
    );
};

export default CustomCursor;
