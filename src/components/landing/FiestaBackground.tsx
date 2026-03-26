import { useEffect, useRef } from "react";
import SpaceBackground from "@/components/landing/SpaceBackground";

const FiestaBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const background = new SpaceBackground(canvasRef.current);
    background.init();

    return () => background.destroy();
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 h-screen w-screen pointer-events-none" />;
};

export default FiestaBackground;
