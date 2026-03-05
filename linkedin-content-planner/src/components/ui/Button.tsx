import React from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    icon?: React.ReactNode;
    children: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
    primary: 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white shadow-[0_4px_14px_rgba(59,130,246,0.3)] hover:shadow-[0_4px_24px_rgba(59,130,246,0.45)] border border-blue-400/20',
    secondary: 'bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20',
    ghost: 'bg-transparent hover:bg-white/5 text-slate-400 hover:text-white border border-transparent',
    danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20',
    success: 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/20',
};

const sizeClasses: Record<Size, string> = {
    sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
    md: 'h-9 px-4 text-sm gap-2 rounded-xl',
    lg: 'h-11 px-5 text-sm gap-2.5 rounded-xl',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'secondary', size = 'md', loading, icon, children, className = '', disabled, ...props }, ref) => {
        const isDisabled = disabled || loading;
        return (
            <button
                ref={ref}
                disabled={isDisabled}
                className={[
                    'inline-flex items-center justify-center font-semibold transition-all duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                    'cursor-pointer select-none',
                    variantClasses[variant],
                    sizeClasses[size],
                    isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '',
                    className,
                ].join(' ')}
                {...props}
            >
                {loading ? <Loader2 size={14} className="animate-spin shrink-0" /> : icon ? <span className="shrink-0">{icon}</span> : null}
                {children}
            </button>
        );
    }
);
Button.displayName = 'Button';
