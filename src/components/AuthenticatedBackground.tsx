const AuthenticatedBackground = () => {
  return (
    <div className="fixed inset-0 pointer-events-none opacity-[0.02] z-0">
      <div className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
                              linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />
    </div>
  );
};

export default AuthenticatedBackground;
