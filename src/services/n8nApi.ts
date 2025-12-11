import type { ResumeAnalysis } from "@/types/ResumeAnalysis";

export interface UploadResponse {
  success: boolean;
  batchId?: string;
  message?: string;
  processedFiles?: string[];
  analysisResults?: ResumeAnalysis[];
  // n8n response fields
  resume?: string;
  candidateName?: string;
  email?: string;
  strengths?: string;
  weaknesses?: string;
  riskFactor?: number;
  rewardFactor?: number;
  fitScore?: number;
  overallFactor?: number;
  justification?: string;
}

export interface N8nError {
  error: string;
  message: string;
}

const N8N_WEBHOOK_URL = "https://siraa.app.n8n.cloud/webhook/4406aa6a-f70a-4d82-b8cc-8c11418c43fe";

export const n8nApi = {
  async uploadResumes(files: File[], recruiterRequirements?: string, recruitmentName?: string): Promise<UploadResponse> {
    const formData = new FormData();
    
    // Append all files using the same key for n8n binary array handling
    files.forEach((file) => {
      formData.append('Please_Upload_Your_Resume_Here', file);
    });
    
    // Add metadata
    formData.append('fileCount', files.length.toString());
    formData.append('timestamp', new Date().toISOString());
    formData.append('source', 'resume-screening-app');
    
    // Add recruiter requirements if provided
    if (recruiterRequirements) {
      formData.append('Recruiter Requirements', recruiterRequirements);
    }
    
    // Add recruitment name if provided
    if (recruitmentName) {
      formData.append('Recruitment Name', recruitmentName);
    }
    
    // Debug logging - print FormData contents
    console.log('FormData contents before sending to n8n:');
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        console.log(`${key}: ${value.name} (${value.size} bytes, ${value.type})`);
      } else {
        console.log(`${key}: ${value}`);
      }
    }
    
    try {
      console.log('Sending request to n8n webhook:', N8N_WEBHOOK_URL);
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || 'Upload failed'}`);
      }
      
      const result = await response.json();
      console.log('Response from n8n:', result);
      
      if (!result.success) {
        throw new Error(result.message || 'Analysis failed');
      }
      
      return result as UploadResponse;
    } catch (error) {
      console.error('Error uploading to n8n:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to upload files to analysis service');
    }
  }
};