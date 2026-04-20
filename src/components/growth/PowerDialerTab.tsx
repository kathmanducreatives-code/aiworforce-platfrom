import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
    Phone, Play, Square, Activity, History, 
    User, PhoneCall, AlertCircle, CheckCircle2 
} from 'lucide-react';
import { dialerService, DialerStatus } from '@/services/dialerService';
import { toast } from 'sonner';

/**
 * PowerDialer component integrated directly into the Outreach Engine.
 */
export const PowerDialerTab = () => {
    const [status, setStatus] = useState<DialerStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [isActionPending, setIsActionPending] = useState(false);
    const [countdown, setCountdown] = useState<number | null>(null);

    // Polling effect
    useEffect(() => {
        const poll = async () => {
            const data = await dialerService.fetchStatus();
            if (data) {
                setStatus(data);
                
                // Watchdog: Check for transfer_failed
                if (data.isLoopActive && data.currentCall?.status === 'transfer_failed' && countdown === null) {
                    triggerWatchdog();
                }
            }
            setLoading(false);
        };

        const interval = setInterval(poll, 2500);
        poll();
        return () => clearInterval(interval);
    }, [countdown]);

    const triggerWatchdog = () => {
        let count = 3;
        setCountdown(count);
        const timer = setInterval(() => {
            count--;
            setCountdown(count);
            if (count <= 0) {
                clearInterval(timer);
                setCountdown(null);
                dialerService.start(); // Jump-start the next lead
            }
        }, 1000);
    };

    const handleStart = async () => {
        setIsActionPending(true);
        await dialerService.start();
        setIsActionPending(false);
    };

    const handleStop = async () => {
        setIsActionPending(true);
        await dialerService.stop();
        setIsActionPending(false);
    };

    if (loading && !status) return <div className="p-8 text-center text-muted-foreground">Connecting to dialer...</div>;

    const isActive = status?.isLoopActive || false;
    const currentCall = status?.currentCall;

    return (
        <div className="space-y-6">
            {/* Header Controls */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-muted'}`} />
                    <div>
                        <h3 className="text-lg font-bold">Dialer Intelligence</h3>
                        <p className="text-sm text-muted-foreground">{isActive ? 'Looping through lead list' : 'System idle'}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    {!isActive ? (
                        <Button onClick={handleStart} disabled={isActionPending} className="bg-emerald-600 hover:bg-emerald-500">
                            <Play className="w-4 h-4 mr-2" /> Start Loop
                        </Button>
                    ) : (
                        <Button onClick={handleStop} disabled={isActionPending} variant="destructive">
                            <Square className="w-4 h-4 mr-2" /> Stop Loop
                        </Button>
                    )}
                </div>
            </div>

            {/* Active Call / Watchdog Notification */}
            {countdown !== null && (
                <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-500 animate-bounce" />
                        <div>
                            <p className="font-bold text-amber-500 uppercase text-xs tracking-wider">Resilience Watchdog Active</p>
                            <p className="text-sm text-muted-foreground">Transfer failed. Auto-restarting in <span className="text-foreground font-mono font-bold">{countdown}s</span></p>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Current Lead Card */}
                <Card className={`relative overflow-hidden ${currentCall ? 'border-primary/50' : ''}`}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center justify-between">
                            Active Call
                            {currentCall && (
                                <Badge variant="outline" className={`${currentCall.status === 'live_answer' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-primary/10 text-primary'}`}>
                                    {currentCall.status_label || currentCall.status}
                                </Badge>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="h-[200px] flex flex-col items-center justify-center text-center">
                        {currentCall ? (
                            <div className="space-y-4 w-full">
                                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                                    <User className="w-8 h-8 text-primary" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold">{currentCall.name || 'Unknown Candidate'}</div>
                                    <div className="text-muted-foreground font-mono">{currentCall.phone}</div>
                                </div>
                                <div className="text-emerald-500 text-sm font-bold flex items-center justify-center gap-2">
                                    <Activity className="w-3 h-3 animate-pulse" />
                                    Live Interaction In Progress
                                </div>
                            </div>
                        ) : (
                            <div className="text-muted-foreground">
                                <PhoneCall className="w-12 h-12 mb-3 opacity-10 mx-auto" />
                                <p>No active call session</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Session History */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <History className="w-4 h-4" /> Live Activity Feed
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3 max-h-[220px] overflow-y-auto pr-2">
                            {status?.sessionLog && status.sessionLog.length > 0 ? (
                                status.sessionLog.map((log, i) => (
                                    <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/50 text-xs">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                                            <span className="font-bold">{log.name}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge variant="secondary" className="text-[9px] uppercase tracking-tighter">
                                                {log.outcome}
                                            </Badge>
                                            <span className="text-muted-foreground opacity-60">
                                                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center p-8 text-muted-foreground text-xs italic">
                                    No logs recorded this session
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
