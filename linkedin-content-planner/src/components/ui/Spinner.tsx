import React from 'react';
import { Loader2 } from 'lucide-react';

interface SpinnerProps { size?: number; className?: string; }

export const Spinner: React.FC<SpinnerProps> = ({ size = 18, className = '' }) => (
    <Loader2 size={size} className={`animate-spin text-slate-400 ${className}`} />
);

export const PageLoader: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
    <div className="flex flex-col items-center justify-center gap-3 p-16 text-slate-500">
        <Spinner size={24} className="text-blue-500" />
        <span className="text-sm">{message}</span>
    </div>
);
