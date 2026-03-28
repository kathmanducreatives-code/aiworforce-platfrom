import { Target, Search, Brain, Mail, Radar, Eye, Zap, PenTool, Shield, Cpu } from 'lucide-react';

export type DepartmentId = 'talent' | 'growth' | 'content' | 'intelligence' | 'command';

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  department: DepartmentId;
  photo: string;
  status: 'active' | 'idle' | 'disabled';
  lastActive?: string;
}

export const AGENTS: AgentDef[] = [
  { id: 'scout', name: 'Scout', role: 'Candidate Sourcing', department: 'talent', photo: '/agents/scout.png', status: 'active', lastActive: '2 min ago' },
  { id: 'aria', name: 'Aria', role: 'AI Screening', department: 'talent', photo: '/agents/aria.png', status: 'active', lastActive: '5 min ago' },
  { id: 'expert', name: 'Expert', role: 'Interview Coordination', department: 'talent', photo: '/agents/expert.png', status: 'active', lastActive: '12 min ago' },
  { id: 'radar', name: 'Radar', role: 'Signal Detection', department: 'growth', photo: '/agents/radar.png', status: 'disabled' },
  { id: 'penn', name: 'Penn', role: 'Outreach Writer', department: 'growth', photo: '/agents/penn.png', status: 'disabled' },
  { id: 'relay', name: 'Relay', role: 'Distribution', department: 'growth', photo: '/agents/relay.png', status: 'disabled' },
  { id: 'scribe', name: 'Scribe', role: 'Content Creation', department: 'content', photo: '/agents/scribe.png', status: 'disabled' },
  { id: 'hawk', name: 'Hawk', role: 'Competitor Monitoring', department: 'intelligence', photo: '/agents/hawk.png', status: 'active', lastActive: '1 hr ago' },
];

export function getAgentsByDepartment(deptId: DepartmentId): AgentDef[] {
  return AGENTS.filter(a => a.department === deptId);
}

export function getActiveAgentCount(deptId: DepartmentId): number {
  return AGENTS.filter(a => a.department === deptId && a.status === 'active').length;
}
