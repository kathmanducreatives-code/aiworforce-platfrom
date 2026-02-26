import { useState, useEffect } from 'react';
import { Bell, UserPlus, Search, Mail, Calendar, CheckCircle, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';

interface Notification {
    id: string;
    type: 'candidate' | 'scrape' | 'email' | 'interview' | 'system';
    title: string;
    description: string;
    time: string;
    read: boolean;
}

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

function timeAgo(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
}

function futureTime(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = date.getTime() - now.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `in ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `in ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    return `in ${diffD}d`;
}

interface NotificationCenterProps {
    collapsed?: boolean;
}

const NotificationCenter = ({ collapsed = false }: NotificationCenterProps) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [markedRead, setMarkedRead] = useState(false);

    useEffect(() => {
        fetchNotifications();
    }, []);

    const fetchNotifications = async () => {
        try {
            setLoading(true);
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
            const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

            const [candidatesRes, emailsRes, interviewsRes, leadsRes] = await Promise.all([
                supabase
                    .from('resume_analyses')
                    .select('id, candidate_name, recruitment_name, created_at')
                    .gte('created_at', oneDayAgo)
                    .order('created_at', { ascending: false })
                    .limit(5),
                supabase
                    .from('scheduled_emails')
                    .select('id, candidate_name, sequence_name, status, send_time_utc')
                    .gte('send_time_utc', oneDayAgo)
                    .order('send_time_utc', { ascending: false })
                    .limit(5),
                supabase
                    .from('interviews')
                    .select('id, candidate_name, scheduled_at, duration_minutes, status')
                    .gte('scheduled_at', oneDayAgo)
                    .lte('scheduled_at', oneDayFromNow)
                    .eq('status', 'scheduled')
                    .order('scheduled_at', { ascending: true })
                    .limit(5),
                supabase
                    .from('candidate_profiles')
                    .select('id, scrape_run_id, created_at')
                    .gte('created_at', oneDayAgo)
                    .order('created_at', { ascending: false })
                    .limit(50),
            ]);

            const items: Notification[] = [];

            // Candidate notifications
            (candidatesRes.data || []).forEach((c) => {
                items.push({
                    id: `candidate-${c.id}`,
                    type: 'candidate',
                    title: 'New applicant',
                    description: `${c.candidate_name} applied${c.recruitment_name ? ` for ${c.recruitment_name}` : ''}`,
                    time: timeAgo(c.created_at),
                    read: false,
                });
            });

            // Email notifications — group by sequence
            const emailsBySeq = new Map<string, { count: number; time: string }>();
            (emailsRes.data || []).forEach((e) => {
                const key = e.sequence_name || 'Outreach';
                const existing = emailsBySeq.get(key);
                if (existing) {
                    existing.count++;
                } else {
                    emailsBySeq.set(key, { count: 1, time: e.send_time_utc });
                }
            });
            emailsBySeq.forEach((val, seqName) => {
                items.push({
                    id: `email-${seqName}`,
                    type: 'email',
                    title: 'Email sequence activity',
                    description: `${val.count} email${val.count > 1 ? 's' : ''} in "${seqName}"`,
                    time: timeAgo(val.time),
                    read: false,
                });
            });

            // Interview notifications
            (interviewsRes.data || []).forEach((i) => {
                const scheduledAt = new Date(i.scheduled_at);
                const isPast = scheduledAt < now;
                items.push({
                    id: `interview-${i.id}`,
                    type: 'interview',
                    title: isPast ? 'Interview completed' : 'Interview reminder',
                    description: `${i.candidate_name} — ${i.duration_minutes}min ${isPast ? 'interview ended' : futureTime(i.scheduled_at)}`,
                    time: isPast ? timeAgo(i.scheduled_at) : futureTime(i.scheduled_at),
                    read: isPast,
                });
            });

            // Scrape notifications — group by scrape_run_id
            const scrapeRuns = new Map<string, { count: number; time: string }>();
            (leadsRes.data || []).forEach((l) => {
                const key = l.scrape_run_id || 'batch';
                const existing = scrapeRuns.get(key);
                if (existing) {
                    existing.count++;
                } else {
                    scrapeRuns.set(key, { count: 1, time: l.created_at || now.toISOString() });
                }
            });
            scrapeRuns.forEach((val, runId) => {
                items.push({
                    id: `scrape-${runId}`,
                    type: 'scrape',
                    title: 'Scrape completed',
                    description: `${val.count} new lead${val.count > 1 ? 's' : ''} found`,
                    time: timeAgo(val.time),
                    read: false,
                });
            });

            // Sort: unread first, then by recency
            items.sort((a, b) => {
                if (a.read !== b.read) return a.read ? 1 : -1;
                return 0;
            });

            setNotifications(items);
        } catch (error) {
            console.error('Error fetching notifications:', error);
        } finally {
            setLoading(false);
        }
    };

    const visibleNotifications = notifications.filter(n => !dismissed.has(n.id));
    const unreadCount = markedRead ? 0 : visibleNotifications.filter(n => !n.read).length;

    const markAllRead = () => {
        setMarkedRead(true);
    };

    const dismissNotification = (id: string) => {
        setDismissed(prev => new Set(prev).add(id));
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
                    {loading ? (
                        <div className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading...
                        </div>
                    ) : visibleNotifications.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No notifications</div>
                    ) : (
                        visibleNotifications.map((n) => {
                            const Icon = typeIcons[n.type];
                            const color = typeColors[n.type];
                            const isUnread = !markedRead && !n.read;
                            return (
                                <div
                                    key={n.id}
                                    className={cn(
                                        'flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0',
                                        isUnread && 'bg-primary/[0.02]'
                                    )}
                                >
                                    <div className={cn('p-1.5 rounded-lg flex-shrink-0 mt-0.5', color)}>
                                        <Icon className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={cn('text-sm font-medium text-foreground', isUnread && 'font-semibold')}>
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
