import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  FileText, 
  Star, 
  TrendingUp, 
  Download, 
  Eye, 
  Filter,
  Search,
  BarChart3,
  Users,
  Clock
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface ResumeAnalysis {
  id: string;
  candidateName: string;
  filename: string;
  overallScore: number;
  skillsMatch: number;
  experienceMatch: number;
  educationMatch: number;
  status: 'excellent' | 'good' | 'fair' | 'poor';
  keySkills: string[];
  experience: string;
  location: string;
  analyzedAt: string;
}

const mockResumes: ResumeAnalysis[] = [
  {
    id: '1',
    candidateName: 'Sarah Johnson',
    filename: 'sarah_johnson_resume.pdf',
    overallScore: 94,
    skillsMatch: 96,
    experienceMatch: 92,
    educationMatch: 95,
    status: 'excellent',
    keySkills: ['React', 'TypeScript', 'Node.js', 'AWS', 'Python'],
    experience: '5+ years Senior Developer',
    location: 'San Francisco, CA',
    analyzedAt: '2 minutes ago'
  },
  {
    id: '2',
    candidateName: 'Michael Chen',
    filename: 'michael_chen_cv.pdf',
    overallScore: 87,
    skillsMatch: 89,
    experienceMatch: 85,
    educationMatch: 88,
    status: 'excellent',
    keySkills: ['JavaScript', 'React', 'MongoDB', 'Express', 'Docker'],
    experience: '4 years Full Stack Developer',
    location: 'New York, NY',
    analyzedAt: '5 minutes ago'
  },
  {
    id: '3',
    candidateName: 'Emily Rodriguez',
    filename: 'emily_rodriguez_resume.docx',
    overallScore: 78,
    skillsMatch: 82,
    experienceMatch: 74,
    educationMatch: 80,
    status: 'good',
    keySkills: ['Vue.js', 'PHP', 'MySQL', 'Laravel', 'Git'],
    experience: '3 years Frontend Developer',
    location: 'Austin, TX',
    analyzedAt: '8 minutes ago'
  },
  {
    id: '4',
    candidateName: 'David Kim',
    filename: 'david_kim_cv.pdf',
    overallScore: 65,
    skillsMatch: 70,
    experienceMatch: 60,
    educationMatch: 68,
    status: 'fair',
    keySkills: ['HTML', 'CSS', 'JavaScript', 'Bootstrap', 'jQuery'],
    experience: '2 years Junior Developer',
    location: 'Seattle, WA',
    analyzedAt: '12 minutes ago'
  }
];

const Dashboard = () => {
  const [resumes] = useState<ResumeAnalysis[]>(mockResumes);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'excellent': return 'bg-accent text-accent-foreground';
      case 'good': return 'bg-primary text-primary-foreground';
      case 'fair': return 'bg-secondary text-secondary-foreground';
      case 'poor': return 'bg-destructive text-destructive-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-accent';
    if (score >= 80) return 'text-primary';
    if (score >= 70) return 'text-muted-foreground';
    return 'text-destructive';
  };

  const filteredResumes = resumes.filter(resume => 
    resume.candidateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    resume.keySkills.some(skill => skill.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <section className="py-16 lg:py-24 bg-gradient-subtle">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              Resume Analysis Dashboard
            </h2>
            <p className="text-xl text-muted-foreground">
              AI-powered insights and scoring for intelligent candidate selection
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid md:grid-cols-4 gap-6 mb-8">
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Resumes</p>
                  <p className="text-2xl font-bold text-foreground">24</p>
                </div>
                <FileText className="h-8 w-8 text-primary" />
              </div>
            </Card>
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Excellent Matches</p>
                  <p className="text-2xl font-bold text-accent">8</p>
                </div>
                <Star className="h-8 w-8 text-accent" />
              </div>
            </Card>
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg Score</p>
                  <p className="text-2xl font-bold text-foreground">81</p>
                </div>
                <TrendingUp className="h-8 w-8 text-primary" />
              </div>
            </Card>
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Time Saved</p>
                  <p className="text-2xl font-bold text-foreground">18h</p>
                </div>
                <Clock className="h-8 w-8 text-primary" />
              </div>
            </Card>
          </div>

          {/* Filters and Search */}
          <Card className="p-6 mb-8">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Search candidates or skills..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 w-full md:w-80"
                  />
                </div>
                <Button variant="outline" className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Analytics
                </Button>
                <Button variant="outline" className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </div>
            </div>
          </Card>

          {/* Resume Cards */}
          <div className="grid gap-6">
            {filteredResumes.map((resume) => (
              <Card key={resume.id} className="p-6 hover:shadow-md transition-all duration-200">
                <div className="grid lg:grid-cols-4 gap-6">
                  {/* Candidate Info */}
                  <div className="lg:col-span-2">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-semibold text-foreground">{resume.candidateName}</h3>
                        <p className="text-sm text-muted-foreground mb-2">{resume.filename}</p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            {resume.experience}
                          </span>
                          <span>{resume.location}</span>
                        </div>
                      </div>
                      <Badge className={getStatusColor(resume.status)} variant="secondary">
                        {resume.status.charAt(0).toUpperCase() + resume.status.slice(1)}
                      </Badge>
                    </div>
                    
                    {/* Skills */}
                    <div className="mb-4">
                      <p className="text-sm font-medium text-foreground mb-2">Key Skills</p>
                      <div className="flex flex-wrap gap-2">
                        {resume.keySkills.map((skill, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Scoring */}
                  <div className="space-y-4">
                    <div className="text-center">
                      <div className={`text-3xl font-bold ${getScoreColor(resume.overallScore)}`}>
                        {resume.overallScore}%
                      </div>
                      <p className="text-sm text-muted-foreground">Overall Match</p>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>Skills Match</span>
                          <span>{resume.skillsMatch}%</span>
                        </div>
                        <Progress value={resume.skillsMatch} className="h-2" />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>Experience</span>
                          <span>{resume.experienceMatch}%</span>
                        </div>
                        <Progress value={resume.experienceMatch} className="h-2" />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>Education</span>
                          <span>{resume.educationMatch}%</span>
                        </div>
                        <Progress value={resume.educationMatch} className="h-2" />
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col justify-between">
                    <div className="text-xs text-muted-foreground mb-4">
                      Analyzed {resume.analyzedAt}
                    </div>
                    <div className="space-y-2">
                      <Button className="w-full" size="sm">
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                      <Button variant="outline" className="w-full" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Dashboard;