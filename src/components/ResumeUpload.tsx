import { useState, useCallback } from "react";
import { Upload, FileText, X, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { n8nApi } from "@/services/n8nApi";

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: 'uploading' | 'completed' | 'error';
  progress: number;
  n8nBatchId?: string;
}

const ResumeUpload = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();

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
      status: 'uploading' as const,
      progress: 0
    }));

    setFiles(prev => [...prev, ...newFiles]);

    try {
      // Update progress to show upload starting
      setFiles(prev => prev.map(f => 
        newFiles.find(nf => nf.id === f.id) ? { ...f, progress: 25 } : f
      ));

      // Send files to n8n webhook
      const response = await n8nApi.uploadResumes(fileList);
      
      setFiles(prev => prev.map(f => {
        const newFile = newFiles.find(nf => nf.id === f.id);
        if (newFile) {
          return { 
            ...f, 
            status: 'completed', 
            progress: 100,
            n8nBatchId: response.batchId
          };
        }
        return f;
      }));

      toast({
        title: "Upload Successful",
        description: `${fileList.length} resume(s) uploaded and sent for AI analysis.`,
      });

    } catch (error) {
      setFiles(prev => prev.map(f => {
        const newFile = newFiles.find(nf => nf.id === f.id);
        return newFile ? { ...f, status: 'error', progress: 0 } : f;
      }));

      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload resumes. Please try again.",
        variant: "destructive",
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
    <section className="py-16 lg:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              Upload Your Resumes
            </h2>
            <p className="text-xl text-muted-foreground">
              Drag and drop multiple resume files or click to browse. Supports PDF, DOC, and DOCX formats.
            </p>
          </div>

          <Card className="p-8">
            {/* Upload Area */}
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200 ${
                isDragOver 
                  ? 'border-primary bg-primary/5' 
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="space-y-4">
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <Upload className="w-8 h-8 text-primary" />
                </div>
                <div>
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
                    <Button asChild>
                      <span className="cursor-pointer">
                        Browse Files
                      </span>
                    </Button>
                  </label>
                </div>
                <div className="text-sm text-muted-foreground">
                  Supports PDF, DOC, DOCX • Max 10MB per file
                </div>
              </div>
            </div>

            {/* File List */}
            {files.length > 0 && (
              <div className="mt-8 space-y-4">
                <h4 className="font-semibold text-foreground">Uploaded Files ({files.length})</h4>
                <div className="space-y-3">
                  {files.map(file => (
                    <div key={file.id} className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg">
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
                              <CheckCircle className="w-5 h-5 text-accent" />
                            )}
                            {file.status === 'error' && (
                              <AlertCircle className="w-5 h-5 text-destructive" />
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFile(file.id)}
                              className="h-8 w-8 p-0"
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
                
                {files.some(f => f.status === 'completed') && (
                  <div className="pt-4 border-t border-border">
                    <Button className="w-full bg-gradient-primary hover:shadow-primary transition-all duration-300">
                      Analyze Resumes ({files.filter(f => f.status === 'completed').length})
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
};

export default ResumeUpload;