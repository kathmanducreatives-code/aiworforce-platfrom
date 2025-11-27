import { useState, useCallback } from "react";
import { Upload, FileText, X, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { n8nApi } from "@/services/n8nApi";
import { supabase } from "@/integrations/supabase/client";
import type { ResumeAnalysis } from "@/types/ResumeAnalysis";

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  file: File;
  status: 'ready' | 'uploading' | 'completed' | 'error';
  progress: number;
  n8nBatchId?: string;
}

const ResumeUpload = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [recruiterRequirements, setRecruiterRequirements] = useState("");
  const [recruitmentName, setRecruitmentName] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showRecruitmentNameDialog, setShowRecruitmentNameDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const { toast } = useToast();

  // Typing timeout for glow effect
  const typingTimeoutRef = useState<NodeJS.Timeout | null>(null);

  const handleRequirementsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRecruiterRequirements(e.target.value);
    setIsTyping(true);
    
    // Clear existing timeout
    if (typingTimeoutRef[0]) {
      clearTimeout(typingTimeoutRef[0]);
    }
    
    // Set new timeout to stop glow effect after 2 seconds of no typing
    typingTimeoutRef[1](setTimeout(() => {
      setIsTyping(false);
    }, 2000));
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    processFiles(droppedFiles);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      processFiles(selectedFiles);
    }
  };

  const processFiles = async (fileList: File[]) => {
    const newFiles: UploadedFile[] = fileList.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: file.size,
      file,
      status: 'ready' as const,
      progress: 0,
    }));

    setFiles(prev => [...prev, ...newFiles]);

    toast({
      title: "Files added",
      description: `${fileList.length} resume(s) ready. Click Analyze Resumes to start.`,
    });
  };

  const handleAnalyzeClick = () => {
    const readyFiles = files.filter(f => f.status === 'ready');
    if (readyFiles.length === 0) {
      toast({ title: 'No files to analyze', description: 'Add resumes first.' });
      return;
    }

    if (!recruiterRequirements.trim()) {
      toast({ 
        title: 'Recruiter Requirements Required', 
        description: 'Please fill in the job requirements before analyzing resumes.',
        variant: 'destructive'
      });
      return;
    }

    setShowRecruitmentNameDialog(true);
  };

  const handleRecruitmentNameSubmit = () => {
    if (!recruitmentName.trim()) {
      toast({
        title: 'Recruitment Name Required',
        description: 'Please enter a name for this recruitment.',
        variant: 'destructive'
      });
      return;
    }
    setShowRecruitmentNameDialog(false);
    setShowConfirmDialog(true);
  };

  const analyzeResumes = async () => {
    const readyFiles = files.filter(f => f.status === 'ready');
    setShowConfirmDialog(false);

    console.log('Starting resume analysis...');
    setFiles(prev => prev.map(f =>
      readyFiles.some(r => r.id === f.id)
        ? { ...f, status: 'uploading', progress: 0 }
        : f
    ));

    try {
      // Simulate progress for upload phase
      for (let progress = 0; progress <= 50; progress += 10) {
        setFiles(prev => prev.map(f => 
          readyFiles.some(rf => rf.id === f.id)
            ? { ...f, progress }
            : f
        ));
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Send to n8n for AI analysis
      console.log('Sending files to n8n for analysis...');
      const analysisResponse = await n8nApi.uploadResumes(readyFiles.map(f => f.file), recruiterRequirements, recruitmentName);
      console.log('Analysis response from n8n:', analysisResponse);

      // Update progress
      setFiles(prev => prev.map(f => 
        readyFiles.some(rf => rf.id === f.id)
          ? { ...f, progress: 75 }
          : f
      ));

      // For now, we'll wait for n8n to process and save to database
      // Check if the analysis results are available
      console.log('Waiting for analysis results to be saved to database...');
      
      // Poll the database for new results for up to 30 seconds
      let attempts = 0;
      const maxAttempts = 30;
      let newResults: ResumeAnalysis[] = [];
      
      while (attempts < maxAttempts && newResults.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        
        try {
          const { data: checkData } = await supabase
            .from('resume_analyses')
            .select('*')
            .eq('recruitment_name', recruitmentName)
            .order('created_at', { ascending: false })
            .limit(readyFiles.length);
            
          if (checkData && checkData.length > 0) {
            // Check if these are new results (created in the last 2 minutes)
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
            const recentResults = checkData.filter(result => 
              new Date(result.created_at) > twoMinutesAgo
            );
            
            // Transform to ResumeAnalysis format
            newResults = recentResults.map((row: any) => ({
              id: row.id,
              date: row.created_at ? new Date(row.created_at).toISOString().split('T')[0] : '',
              resume: row.resume || '',
              candidateName: row.candidate_name || 'Unknown',
              email: row.email || '',
              strengths: row.strengths ? (Array.isArray(row.strengths) ? row.strengths : [row.strengths]) : [],
              weaknesses: row.weaknesses ? (Array.isArray(row.weaknesses) ? row.weaknesses : [row.weaknesses]) : [],
              riskFactor: typeof row.risk_factor === 'number' ? row.risk_factor : 0,
              rewardFactor: typeof row.reward_factor === 'number' ? row.reward_factor : 0,
              fitScore: typeof row.fit_score === 'number' ? row.fit_score : 0,
              overallFactor: typeof row.overall_factor === 'number' ? row.overall_factor : 0,
              justification: row.justification || '',
              recruitmentName: row.recruitment_name || recruitmentName
            }));
          }
        } catch (error) {
          console.error('Error checking for analysis results:', error);
        }
        
        attempts++;
        console.log(`Checking for results... attempt ${attempts}/${maxAttempts}`);
      }
      
      if (newResults.length > 0) {
        console.log(`Found ${newResults.length} new analysis results in database`);
      } else {
        console.log('No new results found in database after waiting');
      }

      setFiles(prev => prev.map(f =>
        readyFiles.some(r => r.id === f.id)
          ? { ...f, status: 'completed', progress: 100, n8nBatchId: analysisResponse.batchId }
          : f
      ));

      toast({ 
        title: 'Analysis Complete', 
        description: `Successfully analyzed ${readyFiles.length} resume(s) and saved results to database.` 
      });
    } catch (error) {
      console.error('Analysis failed:', error);
      setFiles(prev => prev.map(f =>
        readyFiles.some(r => r.id === f.id)
          ? { ...f, status: 'error', progress: 0 }
          : f
      ));
      toast({
        title: 'Failed to analyze',
        description: error instanceof Error ? error.message : 'Failed to send resumes. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const removeFile = (id: string) => {
    setFiles(files.filter(file => file.id !== id));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <section className="py-8 sm:py-12 lg:py-16 bg-background animate-fade-in-up">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8 sm:mb-12 animate-fade-in-down">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground mb-3 sm:mb-4">
              Add Candidates to Intelligence Pipeline
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-muted-foreground">
              Upload resumes to analyze candidate profiles and add them to your centralized intelligence pipeline. Our AI cross-references multiple sources to deliver verified insights.
            </p>
          </div>

          <Card className="p-4 sm:p-6 lg:p-8 animate-scale-in transition-all duration-300 backdrop-blur-sm">
            {/* Upload Area */}
            <div
              className={`border-2 border-dashed rounded-xl p-6 sm:p-8 lg:p-12 text-center transition-all duration-300 ${
                isDragOver 
                  ? 'border-primary bg-primary/10 shadow-glow' 
                  : 'border-primary/20 hover:border-primary/50 hover:bg-card/50 hover:shadow-primary'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="space-y-4">
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center animate-float">
                  <Upload className="w-8 h-8 text-primary" />
                </div>
                <div className="animate-fade-in-up animate-delay-200">
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    Drop your resume files here
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    or click to browse from your computer
                  </p>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileInput}
                    className="hidden"
                    id="file-input"
                  />
                  <label htmlFor="file-input">
                    <Button asChild className="hover-scale active-scale">
                      <span className="cursor-pointer">
                        Browse Files
                      </span>
                    </Button>
                  </label>
                </div>
                <div className="text-sm text-muted-foreground animate-fade-in-up animate-delay-300">
                  Supports PDF, DOC, DOCX • Max 10MB per file
                </div>
              </div>
            </div>

            {/* Recruiter Requirements Section */}
            <div className="mt-8 space-y-4">              
              <div className="space-y-2">
                <Label htmlFor="recruiter-requirements" className="text-base font-semibold text-foreground">
                  Recruiter Requirements *
                </Label>
                <p className="text-sm text-muted-foreground">
                  Describe the job requirements, qualifications, skills, education, and experience needed for this role.
                </p>
                <Textarea
                  id="recruiter-requirements"
                  placeholder="Enter job description, required skills, qualifications, education, experience, and any other requirements for this position..."
                  value={recruiterRequirements}
                  onChange={handleRequirementsChange}
                  onFocus={() => setIsTyping(true)}
                  onBlur={() => {
                    if (typingTimeoutRef[0]) {
                      clearTimeout(typingTimeoutRef[0]);
                    }
                    setIsTyping(false);
                  }}
                  className={`min-h-[120px] resize-none border-2 transition-all duration-300 bg-card/50 backdrop-blur-sm
                    ${isTyping 
                      ? 'border-primary shadow-glow' 
                      : 'border-primary/20'
                    } 
                    hover:border-primary/50 focus:border-primary`}
                  required
                />
              </div>
            </div>

            {/* File List */}
            {files.length > 0 && (
              <div className="mt-8 space-y-4 animate-fade-in-up">
                <h4 className="font-semibold text-foreground">Uploaded Files ({files.length})</h4>
                <div className="space-y-3">
                  {files.map((file, index) => (
                    <div key={file.id} className="flex items-center space-x-4 p-4 bg-card/30 backdrop-blur-sm border border-primary/10 rounded-lg hover:border-primary/30 hover:shadow-primary transition-all duration-300 animate-fade-in-left" style={{animationDelay: `${index * 0.1}s`}}>
                      <div className="flex-shrink-0">
                        <FileText className="w-8 h-8 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {file.name}
                          </p>
                          <div className="flex items-center space-x-2">
                            {file.status === 'completed' && (
                              <CheckCircle className="w-5 h-5 text-accent animate-scale-in" />
                            )}
                            {file.status === 'error' && (
                              <AlertCircle className="w-5 h-5 text-destructive animate-wiggle" />
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFile(file.id)}
                              className="h-8 w-8 p-0 hover-scale active-scale"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </p>
                          {file.status === 'uploading' && (
                            <div className="w-24">
                              <Progress value={file.progress} className="h-2" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {files.some(f => f.status === 'ready') && (
                <div className="pt-4 border-t border-primary/20 animate-fade-in-up animate-delay-300">
                    <Button 
                  onClick={handleAnalyzeClick} 
                  className="w-full"
                  disabled={!recruiterRequirements.trim()}
                  variant="default"
                    >
                      <span>Analyze Resumes ({files.filter(f => f.status === 'ready').length})</span>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Dialog open={showRecruitmentNameDialog} onOpenChange={setShowRecruitmentNameDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enter Recruitment Name</DialogTitle>
                <DialogDescription>
                  Please provide a name for this recruitment position.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <div className="space-y-2">
                  <Label htmlFor="popup-recruitment-name" className="text-base font-semibold text-foreground">
                    Recruitment Name *
                  </Label>
                  <Input
                    id="popup-recruitment-name"
                    placeholder="e.g., Doctor, Mechanical Engineer, Software Developer"
                    value={recruitmentName}
                    onChange={(e) => setRecruitmentName(e.target.value)}
                    className="border-2 border-primary/20 transition-all duration-300 hover:border-primary/50 focus:border-primary bg-card/50 backdrop-blur-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleRecruitmentNameSubmit();
                      }
                    }}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowRecruitmentNameDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleRecruitmentNameSubmit} className="bg-gradient-primary">
                  Continue
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Analysis</DialogTitle>
                <DialogDescription>
                  You are about to analyze resumes for the recruitment:
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <div className="p-4 bg-muted/30 rounded-lg border">
                  <h4 className="font-semibold text-lg text-foreground">{recruitmentName}</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    {files.filter(f => f.status === 'ready').length} resume(s) ready for analysis
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={analyzeResumes} className="bg-gradient-primary">
                  Confirm Analysis
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </section>
  );
};

export default ResumeUpload;