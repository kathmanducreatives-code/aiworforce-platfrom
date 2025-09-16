import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Mail, Users, Star, MapPin, Calendar, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";

const FolderView = () => {
  const { folderName } = useParams();
  const navigate = useNavigate();

  // Mock data for demonstration - you can replace with actual data fetching
  const mockCandidates = [
    {
      id: 1,
      name: "Sarah Johnson",
      role: "Senior Software Engineer",
      location: "San Francisco, CA",
      experience: "5+ years",
      skills: ["React", "TypeScript", "Node.js"],
      rating: 4.8,
      status: "Active",
      phone: "+1 (555) 123-4567",
      appliedDate: "2024-01-15"
    },
    {
      id: 2,
      name: "Michael Chen",
      role: "Full Stack Developer", 
      location: "Seattle, WA",
      experience: "3+ years",
      skills: ["Python", "Django", "React"],
      rating: 4.6,
      status: "Interview Scheduled",
      phone: "+1 (555) 987-6543",
      appliedDate: "2024-01-12"
    },
    {
      id: 3,
      name: "Emily Rodriguez",
      role: "Frontend Developer",
      location: "Austin, TX", 
      experience: "4+ years",
      skills: ["Vue.js", "JavaScript", "CSS"],
      rating: 4.9,
      status: "Under Review",
      phone: "+1 (555) 456-7890",
      appliedDate: "2024-01-10"
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Active": return "bg-green-100 text-green-800";
      case "Interview Scheduled": return "bg-blue-100 text-blue-800";
      case "Under Review": return "bg-yellow-100 text-yellow-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50">
      <Header />
      
      <div className="container mx-auto px-6 py-8 animate-fade-in">
        {/* Header Section */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="hover:bg-slate-100 hover:scale-105 transition-all duration-200 rounded-xl p-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-slate-800 mb-2">
                {folderName} Candidates
              </h1>
              <p className="text-slate-600">
                {mockCandidates.length} candidates in this recruitment folder
              </p>
            </div>
          </div>

          {/* Push to Email Sequence Button */}
          <Button
            onClick={() => navigate(`/email-sequence/${encodeURIComponent(folderName || '')}`)}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 rounded-xl font-medium px-6 py-3 group"
          >
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 group-hover:scale-110 transition-transform duration-200" />
              <span>Push to Email Sequence</span>
              <div className="flex items-center gap-1 ml-2 bg-white/20 rounded-full px-2 py-1 text-sm font-semibold">
                <Users className="h-4 w-4" />
                {mockCandidates.length}
              </div>
            </div>
          </Button>
        </div>

        {/* Candidates Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {mockCandidates.map((candidate, index) => (
            <Card 
              key={candidate.id}
              className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 hover:scale-[1.02] hover:border-cyan-200 rounded-2xl cursor-pointer"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-800 text-lg mb-1 group-hover:text-cyan-600 transition-colors duration-200">
                      {candidate.name}
                    </h3>
                    <p className="text-slate-600 text-sm mb-2">
                      {candidate.role}
                    </p>
                    <Badge className={`${getStatusColor(candidate.status)} text-xs font-medium`}>
                      {candidate.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-amber-500">
                    <Star className="h-4 w-4 fill-current" />
                    <span className="text-sm font-medium text-slate-700">
                      {candidate.rating}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 mb-4">
                  <div className="flex items-center gap-2 text-slate-600 text-sm">
                    <MapPin className="h-4 w-4" />
                    {candidate.location}
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 text-sm">
                    <Calendar className="h-4 w-4" />
                    Applied: {candidate.appliedDate}
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 text-sm">
                    <Phone className="h-4 w-4" />
                    {candidate.phone}
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-slate-600 mb-2">Skills & Experience</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {candidate.skills.map((skill) => (
                      <span 
                        key={skill}
                        className="px-2 py-1 bg-cyan-50 text-cyan-700 rounded-lg text-xs font-medium"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    {candidate.experience} experience
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline" 
                    size="sm"
                    className="flex-1 hover:bg-cyan-50 hover:border-cyan-200 hover:text-cyan-700 transition-all duration-200"
                  >
                    View Profile
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white transition-all duration-200"
                  >
                    Contact
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FolderView;