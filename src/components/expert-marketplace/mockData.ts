export interface Expert {
  id: string;
  name: string;
  avatar: string;
  title: string;
  specializations: string[];
  yearsExperience: number;
  qualityScore: number;
  totalInterviews: number;
  hourlyRate: number;
  verified: boolean;
  degreeVerified: boolean;
  degree: string;
  university: string;
  availability: string;
  bio: string;
}

export interface InterviewRequest {
  id: string;
  candidateName: string;
  candidateEmail: string;
  position: string;
  techStack: string[];
  company: string;
  aiScreeningScore: number;
  status: 'pending_assignment' | 'scheduled' | 'in_progress' | 'recorded' | 'verified_paid';
  expertId?: string;
  expertName?: string;
  scheduledAt?: string;
  duration?: number;
  interviewFee?: number;
  platformFee?: number;
  totalEscrow?: number;
  scorecard?: Scorecard;
  recordingUrl?: string;
}

export interface Scorecard {
  technicalSkills: number;
  problemSolving: number;
  communication: number;
  cultureFit: number;
  overallRating: number;
  strengths: string[];
  concerns: string[];
  recommendation: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire';
  notes: string;
}

export const mockExperts: Expert[] = [
  {
    id: 'exp-1',
    name: 'Dr. Sarah Chen',
    avatar: '',
    title: 'Senior Java Architect',
    specializations: ['Java', 'Spring Boot', 'Microservices', 'System Design'],
    yearsExperience: 14,
    qualityScore: 4.9,
    totalInterviews: 287,
    hourlyRate: 150,
    verified: true,
    degreeVerified: true,
    degree: 'Ph.D. Computer Science',
    university: 'Stanford University',
    availability: 'Available',
    bio: 'Former Principal Engineer at Google. Specialized in distributed systems and backend architecture.',
  },
  {
    id: 'exp-2',
    name: 'Marcus Johnson',
    avatar: '',
    title: 'React & Frontend Architect',
    specializations: ['React', 'TypeScript', 'Next.js', 'GraphQL'],
    yearsExperience: 10,
    qualityScore: 4.7,
    totalInterviews: 193,
    hourlyRate: 130,
    verified: true,
    degreeVerified: true,
    degree: 'M.S. Software Engineering',
    university: 'MIT',
    availability: 'Available',
    bio: 'Built frontend infrastructure at Meta. Expert in React performance and scalable UI architecture.',
  },
  {
    id: 'exp-3',
    name: 'Aisha Patel',
    avatar: '',
    title: 'Full-Stack & DevOps Lead',
    specializations: ['Python', 'AWS', 'Kubernetes', 'CI/CD'],
    yearsExperience: 12,
    qualityScore: 4.8,
    totalInterviews: 241,
    hourlyRate: 140,
    verified: true,
    degreeVerified: true,
    degree: 'M.S. Computer Science',
    university: 'Carnegie Mellon',
    availability: 'Busy until Mar 5',
    bio: 'Former Staff Engineer at Netflix. Expert in cloud infrastructure and scalable system design.',
  },
  {
    id: 'exp-4',
    name: 'Erik Lindqvist',
    avatar: '',
    title: 'Data & ML Engineer',
    specializations: ['Python', 'TensorFlow', 'SQL', 'Data Pipelines'],
    yearsExperience: 8,
    qualityScore: 4.5,
    totalInterviews: 112,
    hourlyRate: 120,
    verified: true,
    degreeVerified: false,
    degree: 'B.S. Mathematics',
    university: 'KTH Royal Institute',
    availability: 'Available',
    bio: 'Lead ML Engineer at Spotify. Specialized in recommendation systems and data engineering.',
  },
  {
    id: 'exp-5',
    name: 'Rachel Kim',
    avatar: '',
    title: 'iOS & Mobile Lead',
    specializations: ['Swift', 'Kotlin', 'React Native', 'Flutter'],
    yearsExperience: 9,
    qualityScore: 4.6,
    totalInterviews: 156,
    hourlyRate: 135,
    verified: false,
    degreeVerified: false,
    degree: 'B.S. Computer Science',
    university: 'UC Berkeley',
    availability: 'Available',
    bio: 'Former Mobile Lead at Uber. Built apps used by millions of users daily.',
  },
];

export const mockInterviewRequests: InterviewRequest[] = [
  {
    id: 'req-1',
    candidateName: 'James Rivera',
    candidateEmail: 'james.rivera@email.com',
    position: 'Senior Backend Engineer',
    techStack: ['Java', 'Spring Boot', 'PostgreSQL'],
    company: 'TechCorp Inc.',
    aiScreeningScore: 92,
    status: 'pending_assignment',
    interviewFee: 150,
    platformFee: 30,
    totalEscrow: 180,
  },
  {
    id: 'req-2',
    candidateName: 'Emily Watson',
    candidateEmail: 'emily.w@email.com',
    position: 'Frontend Developer',
    techStack: ['React', 'TypeScript', 'Next.js'],
    company: 'StartupXYZ',
    aiScreeningScore: 88,
    status: 'scheduled',
    expertId: 'exp-2',
    expertName: 'Marcus Johnson',
    scheduledAt: '2026-03-05T14:00:00Z',
    duration: 60,
    interviewFee: 130,
    platformFee: 26,
    totalEscrow: 156,
  },
  {
    id: 'req-3',
    candidateName: 'David Park',
    candidateEmail: 'david.park@email.com',
    position: 'DevOps Engineer',
    techStack: ['AWS', 'Kubernetes', 'Terraform'],
    company: 'CloudScale Corp',
    aiScreeningScore: 95,
    status: 'recorded',
    expertId: 'exp-3',
    expertName: 'Aisha Patel',
    scheduledAt: '2026-02-20T10:00:00Z',
    duration: 60,
    interviewFee: 140,
    platformFee: 28,
    totalEscrow: 168,
    recordingUrl: '#',
    scorecard: {
      technicalSkills: 5,
      problemSolving: 4,
      communication: 5,
      cultureFit: 4,
      overallRating: 4.5,
      strengths: ['Deep AWS knowledge', 'Excellent system design', 'Clear communicator'],
      concerns: ['Limited Kubernetes hands-on'],
      recommendation: 'strong_hire',
      notes: 'Outstanding candidate with deep cloud infrastructure expertise. Highly recommend for the role.',
    },
  },
  {
    id: 'req-4',
    candidateName: 'Lisa Chen',
    candidateEmail: 'lisa.chen@email.com',
    position: 'ML Engineer',
    techStack: ['Python', 'TensorFlow', 'PyTorch'],
    company: 'AI Solutions Ltd',
    aiScreeningScore: 90,
    status: 'verified_paid',
    expertId: 'exp-4',
    expertName: 'Erik Lindqvist',
    scheduledAt: '2026-02-15T09:00:00Z',
    duration: 60,
    interviewFee: 120,
    platformFee: 24,
    totalEscrow: 144,
    recordingUrl: '#',
    scorecard: {
      technicalSkills: 4,
      problemSolving: 4,
      communication: 3,
      cultureFit: 4,
      overallRating: 3.8,
      strengths: ['Strong ML fundamentals', 'Good model optimization skills'],
      concerns: ['Communication could be clearer', 'Limited production deployment experience'],
      recommendation: 'hire',
      notes: 'Solid technical skills. Would benefit from mentorship on production systems.',
    },
  },
  {
    id: 'req-5',
    candidateName: 'Tom Anderson',
    candidateEmail: 'tom.a@email.com',
    position: 'Senior React Developer',
    techStack: ['React', 'Node.js', 'GraphQL'],
    company: 'WebFlow Inc',
    aiScreeningScore: 85,
    status: 'in_progress',
    expertId: 'exp-2',
    expertName: 'Marcus Johnson',
    scheduledAt: '2026-02-28T15:00:00Z',
    duration: 60,
    interviewFee: 130,
    platformFee: 26,
    totalEscrow: 156,
  },
];
