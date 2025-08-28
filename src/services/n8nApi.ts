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
        mode: 'no-cors',
      });
      
      // With no-cors, the response is opaque. If parsing fails, assume success and inform the user to check n8n logs.
      try {
        const result = await response.json();
        return result as UploadResponse;
      } catch {
        return {
          success: true,
          batchId: `opaque-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          message: 'Request sent to n8n (opaque response). Check n8n execution logs.',
        };
      }
    } catch (error) {
      console.error('Error uploading to n8n:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to upload files');
    }
  }
};