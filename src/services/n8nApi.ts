export interface UploadResponse {
  success: boolean;
  batchId: string;
  message: string;
  processedFiles?: string[];
}

export interface N8nError {
  error: string;
  message: string;
}

const N8N_WEBHOOK_URL = "https://prassidha.app.n8n.cloud/webhook/4406aa6a-f70a-4d82-b8cc-8c11418c43fe";

export const n8nApi = {
  async uploadResumes(files: File[]): Promise<UploadResponse> {
    const formData = new FormData();
    
    files.forEach((file, index) => {
      formData.append(`file_${index}`, file);
    });
    
    // Add metadata
    formData.append('fileCount', files.length.toString());
    formData.append('timestamp', new Date().toISOString());
    formData.append('source', 'resume-screening-app');
    
    try {
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || 'Upload failed'}`);
      }
      
      const result = await response.json();
      
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