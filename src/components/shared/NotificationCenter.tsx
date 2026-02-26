import { useState, forwardRef } from 'react';
import { Bell, UserPlus, Search, Mail, Calendar, CheckCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

interface Notification {
    id: string;
    type: 'candidate' | 'scrape' | 'email' | 'interview' | 'system';
    title: string;
    description: string;
    time: string;
    read: boolean;
}

// Example static notifications — in production, pull from Supabase
const sampleNotifications: Notification[] = [
    { id: '1', type: 'scrape', title: 'Scrape completed', description: '48 new leads found for "Senior Engineer"', time: '5m ago', read: false },
    { id: '2', type: 'candidate', title: 'New applicant', description: 'John Doe applied for Full Stack Developer', time: '1h ago', read: false },
    { id: '3', type: 'email', title: 'Email sequence sent', description: '12 outreach emails delivered successfully', time: '2h ago', read: true },
    { id: '4', type: 'interview', title: 'Interview reminder', description: 'Interview with Sarah at 3:00 PM today', time: '3h ago', read: true },
];

const typeIcons = {
    candidate: UserPlus,
    scrape: Search,
    email: Mail,
    interview: Calendar,
    system: CheckCircle,
};

const typeColors = {
    candidate: 'text-emerald-500 bg-emerald-500/10',
    scrape: 'text-blue-500 bg-blue-500/10',
    email: 'text-purple-500 bg-purple-500/10',
    interview: 'text-amber-500 bg-amber-500/10',
    system: 'text-slate-500 bg-slate-500/10',
};

interface NotificationCenterProps {
    collapsed?: boolean;
}

const NotificationCenter = ({ collapsed = false }: NotificationCenterProps) => {
    const [notifications, setNotifications] = useState<Notification[]>(sampleNotifications);
    const unreadCount = notifications.filter(n => !n.read).length;

    const markAllRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const dismissNotification = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button className={cn(
                    'relative p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground',
                    collapsed && 'mx-auto'
                )}>
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-[10px] text-primary-foreground font-bold rounded-full flex items-center justify-center">
                            {unreadCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
                    {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs text-primary hover:text-primary/80 font-medium transition-colors">
                            Mark all read
                        </button>
                    )}
                </div>
                <div className="max-h-[340px] overflow-y-auto">
                    {notifications.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No notifications</div>
                    ) : (
                        notifications.map((n) => {
                            const Icon = typeIcons[n.type];
                            const color = typeColors[n.type];
                            return (
                                <div
                                    key={n.id}
                                    className={cn(
                                        'flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0',
                                        !n.read && 'bg-primary/[0.02]'
                                    )}
                                >
                                    <div className={cn('p-1.5 rounded-lg flex-shrink-0 mt-0.5', color)}>
                                        <Icon className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={cn('text-sm font-medium text-foreground', !n.read && 'font-semibold')}>
                                            {n.title}
                                        </p>
                                        <p className="text-xs text-muted-foreground truncate">{n.description}</p>
                                        <p className="text-[10px] text-muted-foreground/60 mt-1">{n.time}</p>
                                    </div>
                                    <button onClick={() => dismissNotification(n.id)} className="p-0.5 rounded hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0">
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default NotificationCenter;
