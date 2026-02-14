import { useState, useCallback } from "react";
import { Upload, FileText, Loader2, Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface ExtractedData {
  name: string | null;
  email: string | null;
  phone: string | null;
  current_title: string | null;
  current_company: string | null;
  total_years_experience: number;
  skills: string[];
  education: Array<{ degree: string; field: string; school: string; year: string | null }>;
  work_history: Array<{ company: string; title: string; start_date: string; end_date: string; description: string }>;
  highest_education_level: string;
  certifications: string[];
}

interface ResumeUploadStepProps {
  applicationId: string;
  onComplete: (data: ExtractedData) => void;
}

export default function ResumeUploadStep({ applicationId, onComplete }: ResumeUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedData, setEditedData] = useState<ExtractedData | null>(null);
  const [fileName, setFileName] = useState<string>('');

  const processFile = useCallback(async (file: File) => {
    // Validate file
    const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Please upload a PDF or DOCX file.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 5MB.", variant: "destructive" });
      return;
    }

    setFileName(file.name);
    setIsUploading(true);

    try {
      // Upload to Supabase Storage
      const filePath = `${applicationId}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('screening-resumes')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Update application with resume URL
      await supabase
        .from('screening_applications')
        .update({ resume_url: filePath })
        .eq('id', applicationId);

      setIsUploading(false);
      setIsParsing(true);

      // Read file content as text for AI parsing
      const text = await file.text();

      // Call parse-resume edge function
      const { data, error } = await supabase.functions.invoke('parse-resume', {
        body: { file_content: text, file_name: file.name, application_id: applicationId },
      });

      if (error) throw error;

      const extracted = data.extracted_data;
      setExtractedData(extracted);
      setEditedData(extracted);
    } catch (err: any) {
      console.error('Resume processing error:', err);
      toast({ title: "Processing failed", description: err.message || "Failed to process resume.", variant: "destructive" });
    } finally {
      setIsUploading(false);
      setIsParsing(false);
    }
  }, [applicationId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFieldChange = (field: keyof ExtractedData, value: any) => {
    if (!editedData) return;
    setEditedData({ ...editedData, [field]: value });
  };

  const handleConfirm = async () => {
    const finalData = editMode ? editedData! : extractedData!;
    
    // Save candidate edits
    if (editMode) {
      await supabase
        .from('screening_applications')
        .update({ candidate_edits: finalData as any })
        .eq('id', applicationId);
    }

    onComplete(finalData);
  };

  // Upload / parsing state
  if (isUploading || isParsing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-foreground font-medium">
            {isUploading ? 'Uploading your resume...' : 'Analyzing your resume with AI...'}
          </p>
          <p className="text-sm text-muted-foreground">This usually takes a few seconds</p>
        </div>
      </div>
    );
  }

  // Review extracted data
  if (extractedData) {
    const data = editMode ? editedData! : extractedData;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-lg w-full space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 text-primary">
              <Check className="w-5 h-5" />
              <span className="font-medium">Resume Analyzed</span>
            </div>
            <h2 className="text-2xl font-bold text-foreground">Here's what we found</h2>
            <p className="text-sm text-muted-foreground">Review your information and edit if needed</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="w-4 h-4" />
                {fileName}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditMode(!editMode)}>
                {editMode ? <X className="w-4 h-4 mr-1" /> : <Pencil className="w-4 h-4 mr-1" />}
                {editMode ? 'Cancel' : 'Edit'}
              </Button>
            </div>

            <div className="grid gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Name</Label>
                {editMode ? (
                  <Input value={data.name || ''} onChange={(e) => handleFieldChange('name', e.target.value)} className="mt-1" />
                ) : (
                  <p className="text-foreground font-medium">{data.name || 'Not found'}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  {editMode ? (
                    <Input value={data.email || ''} onChange={(e) => handleFieldChange('email', e.target.value)} className="mt-1" />
                  ) : (
                    <p className="text-foreground text-sm">{data.email || 'Not found'}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Phone</Label>
                  {editMode ? (
                    <Input value={data.phone || ''} onChange={(e) => handleFieldChange('phone', e.target.value)} className="mt-1" />
                  ) : (
                    <p className="text-foreground text-sm">{data.phone || 'Not found'}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Current Title</Label>
                  <p className="text-foreground text-sm">{data.current_title || 'Not found'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Experience</Label>
                  <p className="text-foreground text-sm">{data.total_years_experience} years</p>
                </div>
              </div>

              {data.skills?.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Skills</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {data.skills.slice(0, 10).map((skill) => (
                      <Badge key={skill} variant="secondary" className="text-xs">{skill}</Badge>
                    ))}
                    {data.skills.length > 10 && (
                      <Badge variant="outline" className="text-xs">+{data.skills.length - 10}</Badge>
                    )}
                  </div>
                </div>
              )}

              {data.education?.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Education</Label>
                  <p className="text-foreground text-sm">
                    {data.education[0]?.degree} {data.education[0]?.field ? `in ${data.education[0].field}` : ''} — {data.education[0]?.school}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Button onClick={handleConfirm} size="lg" className="w-full py-5">
            Looks Good — Continue
          </Button>
        </div>
      </div>
    );
  }

  // Initial upload state
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-foreground">Upload Your Resume</h2>
          <p className="text-muted-foreground">We'll extract your info so you don't have to type it all out</p>
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">Drop your resume here</p>
          <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
          <p className="text-xs text-muted-foreground mt-3">PDF or DOCX — Max 5MB</p>
          <input
            id="file-input"
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>
    </div>
  );
}
