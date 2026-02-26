import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import {
    LayoutDashboard, Activity, Calendar, Search, Brain, Target, TrendingUp,
    Mail, Share2, BarChart3, Plus, Upload, Zap, Users,
} from 'lucide-react';

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const pages = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, group: 'Navigate' },
    { label: 'Job Screening', path: '/screening-jobs', icon: Activity, group: 'Navigate' },
    { label: 'Interviews', path: '/interview-scheduler', icon: Calendar, group: 'Navigate' },
    { label: 'Lead Scraper', path: '/lead-scraper', icon: Search, group: 'Navigate' },
    { label: 'Deep Search', path: '/deep-search', icon: Brain, group: 'Navigate' },
    { label: 'ICP Intelligence', path: '/icp-intelligence', icon: Target, group: 'Navigate' },
    { label: 'Growth Signals', path: '/growth-signals', icon: TrendingUp, group: 'Navigate' },
    { label: 'Email Sequences', path: '/email-sequences', icon: Mail, group: 'Navigate' },
    { label: 'Job Distribution', path: '/job-distribution', icon: Share2, group: 'Navigate' },
    { label: 'Analytics', path: '/analytics', icon: BarChart3, group: 'Navigate' },
];

const quickActions = [
    { label: 'Create New Job', path: '/screening-jobs', icon: Plus, group: 'Quick Actions' },
    { label: 'Upload Resume', path: '/screening', icon: Upload, group: 'Quick Actions' },
    { label: 'Start Lead Scrape', path: '/lead-scraper', icon: Zap, group: 'Quick Actions' },
    { label: 'View Candidates', path: '/candidates', icon: Users, group: 'Quick Actions' },
];

const CommandPalette = ({ open, onOpenChange }: CommandPaletteProps) => {
    const navigate = useNavigate();

    // Global keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                onOpenChange(!open);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, onOpenChange]);

    const handleSelect = useCallback((path: string) => {
        onOpenChange(false);
        navigate(path);
    }, [navigate, onOpenChange]);

    return (
        <CommandDialog open={open} onOpenChange={onOpenChange}>
            <CommandInput placeholder="Search pages, actions, candidates..." />
            <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup heading="Quick Actions">
                    {quickActions.map((action) => (
                        <CommandItem key={action.path + action.label} onSelect={() => handleSelect(action.path)} className="gap-3 cursor-pointer">
                            <action.icon className="h-4 w-4 text-primary" />
                            <span>{action.label}</span>
                        </CommandItem>
                    ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Navigate">
                    {pages.map((page) => (
                        <CommandItem key={page.path} onSelect={() => handleSelect(page.path)} className="gap-3 cursor-pointer">
                            <page.icon className="h-4 w-4 text-muted-foreground" />
                            <span>{page.label}</span>
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </CommandDialog>
    );
};

export default CommandPalette;
