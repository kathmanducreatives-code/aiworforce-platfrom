import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DepartmentColumn from './DepartmentColumn';
import PersonnelDrawer from './PersonnelDrawer';
import type { DeptAgent } from './DepartmentColumn';
import type { PersonnelAgent } from './PersonnelDrawer';
import { Target, TrendingUp, Palette, Eye } from 'lucide-react';

/* ─── Department Configuration ─── */

const DEPT_CONFIG = [
  {
    id: 'talent',
    name: 'Talent',
    icon: Target,
    color: '#10B981',
    glowColor: 'rgba(16, 185, 129, 0.15)',
    maxSlots: 5,
  },
  {
    id: 'growth',
    name: 'Growth',
    icon: TrendingUp,
    color: '#3B82F6',
    glowColor: 'rgba(59, 130, 246, 0.15)',
    maxSlots: 4,
  },
  {
    id: 'content',
    name: 'Content',
    icon: Palette,
    color: '#8B5CF6',
    glowColor: 'rgba(139, 92, 246, 0.15)',
    maxSlots: 3,
  },
  {
    id: 'intelligence',
    name: 'Intelligence',
    icon: Eye,
    color: '#F59E0B',
    glowColor: 'rgba(245, 158, 11, 0.15)',
    maxSlots: 4,
  },
] as const;

/* ─── Workforce Roster with full personnel data ─── */

interface FullAgent extends DeptAgent {
  department: string;
  description?: string;
  collaboratesWith?: string[];
  responsibilities?: string[];
}

const WORKFORCE: Record<string, FullAgent[]> = {
  talent: [
    {
      id: 'scout',
      name: 'Scout',
      role: 'Candidate Sourcer',
      avatar: '/agents/20260324_2120_Image Generation_simple_compose_01kmg7r0naeadvd5qprmxwn76w.png',
      status: 'active',
      isOriginal: true,
      enabledTools: ['Firecrawl', 'LinkedIn', 'Apify'],
      lastActive: '2 min ago',
      department: 'talent',
      description: 'Proactively finds and qualifies talent across platforms, databases, and networks to build high-quality candidate pipelines.',
      collaboratesWith: ['Aria', 'Relay'],
      responsibilities: [
        'Source candidates across platforms and databases',
        'Build and maintain candidate pipelines',
        'Qualify leads against role requirements',
        'Deliver structured candidate profiles',
      ],
    },
    {
      id: 'aria',
      name: 'Aria',
      role: 'AI Screening Engine',
      avatar: '/agents/20260328_1020_Futuristic Executive Portrait_simple_compose_01kmsbjdytefjt5nzrafx7mg7h.png',
      status: 'active',
      isOriginal: true,
      enabledTools: ['Claude', 'GPT-4o'],
      lastActive: '5 min ago',
      department: 'talent',
      description: 'Screens and evaluates every candidate with precision scoring, deep assessment, and actionable hiring recommendations.',
      collaboratesWith: ['Scout', 'Vetter', 'Relay'],
      responsibilities: [
        'Screen candidates against job requirements',
        'Generate multi-dimensional fit scores',
        'Create detailed assessment reports',
        'Flag exceptional candidates and red flags',
      ],
    },
    {
      id: 'expert',
      name: 'Expert',
      role: 'Interview Coordinator',
      avatar: '',
      status: 'active',
      enabledTools: ['Calendar', 'Zoom'],
      lastActive: '12 min ago',
      department: 'talent',
      description: 'Manages all interview coordination pipelines including scheduling, briefing, and follow-up workflows.',
      collaboratesWith: ['Aria'],
      responsibilities: [
        'Coordinate interview scheduling',
        'Prepare interviewer briefing packs',
        'Track interview progress and feedback',
        'Manage candidate communication',
      ],
    },
    {
      id: 'vetter',
      name: 'Vetter',
      role: 'Background Verification',
      avatar: '',
      status: 'idle',
      enabledTools: ['Checkr'],
      department: 'talent',
      description: 'Conducts deep qualification checks, credential verification, and background analysis to ensure candidate quality.',
      collaboratesWith: ['Aria', 'Scout'],
      responsibilities: [
        'Verify credentials and experience claims',
        'Cross-reference data across sources',
        'Assess qualification thresholds',
        'Generate verification reports',
      ],
    },
  ],
  growth: [
    {
      id: 'radar',
      name: 'Radar',
      role: 'Signal Detection',
      avatar: '/agents/20260328_1022_Image Generation_simple_compose_01kmsbp7yde03bwrm6pz483pfj.png',
      status: 'idle',
      isOriginal: true,
      enabledTools: ['Firecrawl', 'GPT-4o'],
      department: 'growth',
      description: 'Monitors the market for growth signals, funding events, and high-value opportunities in real-time.',
      collaboratesWith: ['Penn', 'Hawk'],
      responsibilities: [
        'Monitor growth triggers across markets',
        'Detect funding rounds and expansions',
        'Identify high-value prospect signals',
        'Feed actionable leads to outreach pipeline',
      ],
    },
    {
      id: 'penn',
      name: 'Penn',
      role: 'Outreach Writer',
      avatar: '/agents/20260328_1030_Image Generation_simple_compose_01kmsc4292fpfbv69fth1q7v79.png',
      status: 'idle',
      isOriginal: true,
      enabledTools: ['Claude', 'Instantly'],
      department: 'growth',
      description: 'Crafts hyper-personalized outreach sequences that convert cold prospects into warm conversations.',
      collaboratesWith: ['Radar', 'Relay'],
      responsibilities: [
        'Write personalized outreach copy',
        'Build multi-step email sequences',
        'A/B test messaging variants',
        'Optimize for reply rates',
      ],
    },
    {
      id: 'relay',
      name: 'Relay',
      role: 'Distribution Manager',
      avatar: '',
      status: 'disabled',
      department: 'growth',
      description: 'Manages all outbound distribution channels and ensures messages reach the right prospects at the right time.',
    },
  ],
  content: [
    {
      id: 'constructor',
      name: 'Constructor',
      role: 'Content Architect',
      avatar: '/agents/20260328_1027_Image Generation_simple_compose_01kmsbyw6sfkg8grk4hgm9qvp9.png',
      status: 'idle',
      isOriginal: true,
      enabledTools: ['Claude', 'Midjourney'],
      department: 'content',
      description: 'Develops and executes content strategy across all channels, ensuring brand consistency and measurable business impact.',
      collaboratesWith: ['Penn'],
      responsibilities: [
        'Develop content strategy and editorial calendar',
        'Create brand-aligned content across formats',
        'Optimize content for SEO and engagement',
        'Analyze content performance and ROI',
      ],
    },
  ],
  intelligence: [
    {
      id: 'hawk',
      name: 'Hawk',
      role: 'Competitor Monitor',
      avatar: '',
      status: 'active',
      enabledTools: ['Firecrawl', 'GPT-4o'],
      lastActive: '1 hr ago',
      department: 'intelligence',
      description: 'Continuously tracks competitor activity, pricing changes, product launches, and strategic movements.',
      collaboratesWith: ['Radar', 'Prism'],
      responsibilities: [
        'Monitor competitor websites and announcements',
        'Track pricing and feature changes',
        'Detect strategic pivot signals',
        'Generate competitive intelligence briefs',
      ],
    },
    {
      id: 'prism',
      name: 'Prism',
      role: 'Market Analyst',
      avatar: '',
      status: 'disabled',
      department: 'intelligence',
      description: 'Synthesizes market data, trends, and competitive landscapes into strategic intelligence reports.',
    },
  ],
};

/* ─── Component ─── */

const DepartmentMatrix = () => {
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState<PersonnelAgent | null>(null);
  const [selectedDeptColor, setSelectedDeptColor] = useState('#10B981');

  const handleAgentClick = useCallback((agentId: string) => {
    // Find the agent across all departments
    for (const [deptId, agents] of Object.entries(WORKFORCE)) {
      const found = agents.find(a => a.id === agentId);
      if (found) {
        const dept = DEPT_CONFIG.find(d => d.id === deptId);
        setSelectedDeptColor(dept?.color || '#10B981');
        setSelectedAgent(found);
        return;
      }
    }
  }, []);

  const handleHireClick = useCallback((deptId: string) => {
    navigate(`/agent-studio?dept=${deptId}&mode=create`);
  }, [navigate]);

  const handleCloseDrawer = useCallback(() => {
    setSelectedAgent(null);
  }, []);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 h-full">
        {DEPT_CONFIG.map(dept => (
          <DepartmentColumn
            key={dept.id}
            department={dept}
            agents={WORKFORCE[dept.id] || []}
            onAgentClick={handleAgentClick}
            onHireClick={handleHireClick}
          />
        ))}
      </div>

      {/* Personnel Drawer — slides out from right */}
      <PersonnelDrawer
        agent={selectedAgent}
        deptColor={selectedDeptColor}
        onClose={handleCloseDrawer}
      />
    </>
  );
};

export default DepartmentMatrix;
