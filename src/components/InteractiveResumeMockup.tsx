const InteractiveResumeMockup = () => {
  return (
    <div className="relative animate-float-gentle">
      {/* Glow effect behind card */}
      <div className="absolute inset-0 bg-gradient-to-r from-teal-500/20 to-cyan-500/20 blur-3xl rounded-3xl" />
      
      {/* Main card */}
      <div className="relative bg-[#1a1a1a] border border-teal-500/30 rounded-2xl p-8 
                      shadow-[0_0_30px_rgba(20,184,166,0.3)] backdrop-blur-xl
                      hover:border-teal-500/50 transition-all duration-500">
        
        {/* Header: Avatar + Name + Position */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-teal-400 to-cyan-500 
                          flex items-center justify-center text-white text-xl font-bold">
            JD
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">John Doe</h3>
            <p className="text-gray-400 text-sm">Senior Full Stack Developer</p>
          </div>
        </div>
        
        {/* Score Circle */}
        <div className="flex justify-center mb-6">
          <div className="relative w-32 h-32">
            {/* Background circle */}
            <svg className="w-32 h-32 transform -rotate-90">
              <circle cx="64" cy="64" r="56" stroke="rgba(255,255,255,0.1)" 
                      strokeWidth="8" fill="none" />
              {/* Animated progress circle */}
              <circle cx="64" cy="64" r="56" stroke="url(#gradient)" 
                      strokeWidth="8" fill="none" 
                      strokeDasharray="352" strokeDashoffset="88"
                      className="animate-draw-arc" />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#14b8a6" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
            </svg>
            {/* Score text in center */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl font-bold text-white">85%</span>
            </div>
          </div>
        </div>
        
        {/* Skills badges */}
        <div className="mb-6">
          <p className="text-gray-400 text-xs uppercase mb-3">Key Skills</p>
          <div className="flex flex-wrap gap-2">
            {['React', 'TypeScript', 'Node.js', 'AWS'].map((skill) => (
              <span key={skill} 
                    className="px-3 py-1 bg-teal-500/10 border border-teal-500/30 
                              rounded-full text-teal-400 text-sm">
                {skill}
              </span>
            ))}
          </div>
        </div>
        
        {/* Score breakdown */}
        <div className="space-y-3 mb-6">
          {[
            { label: 'Experience', score: 90 },
            { label: 'Education', score: 85 },
            { label: 'Skills Match', score: 80 }
          ].map((item) => (
            <div key={item.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">{item.label}</span>
                <span className="text-white font-medium">{item.score}%</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-teal-500 to-cyan-500 
                              rounded-full transition-all duration-1000"
                     style={{ width: `${item.score}%` }} />
              </div>
            </div>
          ))}
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-3">
          <button className="flex-1 px-4 py-2 bg-teal-500/10 border border-teal-500/30 
                            rounded-lg text-teal-400 text-sm hover:bg-teal-500/20 
                            transition-colors">
            View Details
          </button>
          <button className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg 
                            text-gray-400 text-sm hover:bg-white/10 transition-colors">
            ✓
          </button>
          <button className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg 
                            text-gray-400 text-sm hover:bg-white/10 transition-colors">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

export default InteractiveResumeMockup;
