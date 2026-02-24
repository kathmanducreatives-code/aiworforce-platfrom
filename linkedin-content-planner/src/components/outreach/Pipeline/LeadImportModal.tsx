import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import type { OutreachLead } from '../../../types/outreach';

interface LeadImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImportSuccess: () => void;
}

export default function LeadImportModal({ isOpen, onClose, onImportSuccess }: LeadImportModalProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { addMultipleLeads } = useOutreachLeads();

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
                setError('Please upload a valid CSV file.');
                setFile(null);
                return;
            }
            setFile(selectedFile);
            setError(null);
        }
    };

    const handleImport = () => {
        if (!file) return;
        setIsUploading(true);
        setError(null);

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const headerMap: Record<string, string> = {};
                    const headers = results.meta.fields || [];

                    // Simple auto-mapping
                    headers.forEach(h => {
                        const lower = h.toLowerCase().trim();
                        if (lower.includes('company') && !lower.includes('size')) headerMap[h] = 'company';
                        if (lower.includes('name') || lower.includes('contact')) headerMap[h] = 'contact_name';
                        if (lower.includes('title') || lower.includes('role')) headerMap[h] = 'title';
                        if (lower.includes('email')) headerMap[h] = 'email';
                        if (lower.includes('linkedin') || lower.includes('url')) headerMap[h] = 'linkedin_url';
                        if (lower.includes('industry')) headerMap[h] = 'industry';
                        if (lower.includes('size') || lower.includes('employees')) headerMap[h] = 'company_size';
                        if (lower.includes('notes')) headerMap[h] = 'notes';
                    });

                    const mappedLeads: Partial<OutreachLead>[] = results.data.map((row: any) => {
                        const newLead: Partial<OutreachLead> = {
                            company: row[Object.keys(headerMap).find(k => headerMap[k] === 'company') || ''] || 'Unknown Company',
                            contact_name: row[Object.keys(headerMap).find(k => headerMap[k] === 'contact_name') || ''] || 'Unknown Contact',
                            title: row[Object.keys(headerMap).find(k => headerMap[k] === 'title') || ''] || null,
                            email: row[Object.keys(headerMap).find(k => headerMap[k] === 'email') || ''] || null,
                            linkedin_url: row[Object.keys(headerMap).find(k => headerMap[k] === 'linkedin_url') || ''] || null,
                            industry: row[Object.keys(headerMap).find(k => headerMap[k] === 'industry') || ''] || null,
                            company_size: row[Object.keys(headerMap).find(k => headerMap[k] === 'company_size') || ''] || null,
                            notes: row[Object.keys(headerMap).find(k => headerMap[k] === 'notes') || ''] || null,
                            tier: 'unassigned',
                            status: 'not_started',
                            signals: []
                        };
                        return newLead;
                    });

                    if (mappedLeads.length === 0) {
                        setError('No valid data found in CSV.');
                        setIsUploading(false);
                        return;
                    }

                    const { error } = await addMultipleLeads(mappedLeads);
                    if (error) throw error;

                    onImportSuccess();
                    onClose();
                } catch (err: any) {
                    setError(err.message || 'Failed to import leads.');
                } finally {
                    setIsUploading(false);
                }
            },
            error: (error) => {
                setError(`Error parsing CSV: ${error.message}`);
                setIsUploading(false);
            }
        });
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
            <div style={{
                background: '#141414', border: '1px solid #2a2a2a', borderRadius: '16px',
                width: '100%', maxWidth: '500px', padding: '24px', position: 'relative'
            }}>
                <button
                    onClick={onClose}
                    style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}
                >
                    <X size={20} />
                </button>

                <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Import Leads</h2>
                <p style={{ color: '#888', fontSize: '13px', marginBottom: '24px' }}>Upload a CSV file containing your leads. We'll automatically map standard columns like Name, Company, Email, and Title.</p>

                <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                        border: '2px dashed #333', borderRadius: '12px', padding: '40px 20px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', backgroundColor: file ? 'rgba(0, 229, 160, 0.05)' : '#0d0d0d',
                        borderColor: file ? '#00e5a0' : '#333', transition: 'all 0.2s',
                        marginBottom: '20px'
                    }}
                >
                    <input
                        type="file"
                        accept=".csv"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />
                    {file ? (
                        <>
                            <CheckCircle2 size={32} color="#00e5a0" style={{ marginBottom: '12px' }} />
                            <span style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: 500 }}>{file.name}</span>
                            <span style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>Ready to import</span>
                        </>
                    ) : (
                        <>
                            <Upload size={32} color="#666" style={{ marginBottom: '12px' }} />
                            <span style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: 500 }}>Click to upload CSV</span>
                            <span style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>or drag and drop</span>
                        </>
                    )}
                </div>

                {error && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontSize: '13px', marginBottom: '20px', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '12px', borderRadius: '8px' }}>
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                        onClick={onClose}
                        style={{ background: 'transparent', border: '1px solid #333', color: '#ccc', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={!file || isUploading}
                        style={{
                            background: !file || isUploading ? '#333' : '#00e5a0',
                            color: !file || isUploading ? '#888' : '#000',
                            border: 'none', padding: '10px 16px', borderRadius: '8px',
                            fontSize: '13px', fontWeight: 600, cursor: !file || isUploading ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px'
                        }}
                    >
                        {isUploading ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : 'Import Leads'}
                    </button>
                </div>
            </div>
        </div>
    );
}
