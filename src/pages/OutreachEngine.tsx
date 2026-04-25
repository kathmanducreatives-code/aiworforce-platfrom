import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Zap, Search, Target, Users, Mail, Settings, Activity,
    MessageSquare, CheckCircle, BarChart3, AlertTriangle, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';

// Mock Data / Types
type Lead = {
    id: string;
    name: string;
    title: string;
    company: string;
    score: number;
    tier: "Hot" | "Warm" | "Cold";
    dm: string;
    status: "pending" | "approved" | "flagged" | "sent";
};

const OutreachEngine = () => {
    const [activeTab, setActiveTab] = useState("dashboard");
    const [isDryRun, setIsDryRun] = useState(false);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [queue, setQueue] = useState<Lead[]>([]);

    // Dashboard Stats
    const stats = {
        generated: leads.length,
        dms: queue.length,
        approved: queue.filter(q => q.status === 'approved').length,
        sent: queue.filter(q => q.status === 'sent').length
    };

    const handleSearchPosts = () => {
        toast.info("Searching LinkedIn posts...");
        // Mock response
        setTimeout(() => {
            toast.success("Found 12 high-engagement posts");
        }, 1500);
    };

    const aiSuggestParams = () => {
        toast.info("AI is analyzing optimal parameters...");
        setTimeout(() => {
            toast.success("Parameters validated via ICP Engine");
        }, 2000);
    };

    return (
        <div className="flex-1 w-full space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-border">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Zap className="w-6 h-6 text-primary" />
                        Outreach Engine
                        <Badge variant="secondary" className="ml-2 text-[10px] bg-primary/10 text-primary">BETA</Badge>
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Unified command center for Content and Job-based outbound.</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse"></div>
                        n8n Connected
                    </div>
                    <Button
                        variant={isDryRun ? "destructive" : "outline"}
                        size="sm"
                        onClick={() => setIsDryRun(!isDryRun)}
                        className="text-xs"
                    >
                        <ShieldCheck className="w-4 h-4 mr-2" />
                        {isDryRun ? "DRY RUN: ON" : "DRY RUN: OFF"}
                    </Button>
                </div>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full justify-start border-b border-border rounded-none h-auto bg-transparent p-0 pb-px mb-6">
                    <TabsTrigger value="dashboard" className="data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent rounded-none px-4 py-2">
                        Dashboard
                    </TabsTrigger>
                    <TabsTrigger value="content" className="data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent rounded-none px-4 py-2">
                        Content Outreach
                    </TabsTrigger>
                    <TabsTrigger value="jobs" className="data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent rounded-none px-4 py-2">
                        Job Outreach
                    </TabsTrigger>
                    <TabsTrigger value="queue" className="data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent rounded-none px-4 py-2 flex items-center gap-2">
                        Review Queue
                        {queue.length > 0 && (
                            <Badge variant="destructive" className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]">
                                {queue.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent rounded-none px-4 py-2">
                        Settings
                    </TabsTrigger>
                </TabsList>

                {/* Dashboard Tab */}
                <TabsContent value="dashboard" className="space-y-6">
                    {/* Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <Card>
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between space-y-0 pb-2">
                                    <p className="text-sm font-medium text-muted-foreground">Leads Generated</p>
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="text-3xl font-bold">{stats.generated}</div>
                                <p className="text-xs text-emerald-500 mt-1">↑ +14% from last week</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between space-y-0 pb-2">
                                    <p className="text-sm font-medium text-muted-foreground">DMs Generated</p>
                                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="text-3xl font-bold">{stats.dms}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between space-y-0 pb-2">
                                    <p className="text-sm font-medium text-muted-foreground">Approved</p>
                                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                                </div>
                                <div className="text-3xl font-bold">{stats.approved}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between space-y-0 pb-2">
                                    <p className="text-sm font-medium text-muted-foreground">Sent</p>
                                    <Mail className="h-4 w-4 text-primary" />
                                </div>
                                <div className="text-3xl font-bold">{stats.sent}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between space-y-0 pb-2">
                                    <p className="text-sm font-medium text-muted-foreground">Avg DM Score</p>
                                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="text-3xl font-bold">—</div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Quick Actions</CardTitle>
                                <CardDescription>Jump into a workflow</CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3">
                                <Button className="w-full justify-start" onClick={() => setActiveTab('content')}>
                                    <Zap className="mr-2 h-4 w-4" /> Scrape competitor post → generate leads
                                </Button>
                                <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab('jobs')}>
                                    <Search className="mr-2 h-4 w-4" /> Find founders via job postings
                                </Button>
                                <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab('queue')}>
                                    <CheckCircle className="mr-2 h-4 w-4" /> Review & approve pending DMs ({stats.dms})
                                </Button>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Recent Activity</CardTitle>
                                <CardDescription>Last 24 hours</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                                    <Activity className="h-10 w-10 mb-3 opacity-20" />
                                    <p>No activity yet.</p>
                                    <p className="text-sm">Start a campaign to see it here.</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Content Outreach Tab */}
                <TabsContent value="content" className="space-y-6">
                    {/* Pipeline visualizer */}
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground overflow-x-auto pb-2">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-medium">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs">1</span> Scrape Posts
                        </div>
                        <span>→</span>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-foreground text-xs">2</span> Identify Leads
                        </div>
                        <span>→</span>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-foreground text-xs">3</span> Generate DMs
                        </div>
                        <span>→</span>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-foreground text-xs">4</span> Review & Send
                        </div>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Step 1 — Scrape Posts</CardTitle>
                            <CardDescription>Enter a LinkedIn post URL or competitor profile to find viral posts</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col md:flex-row gap-4 items-end">
                                <div className="flex-1 space-y-2">
                                    <label className="text-sm font-medium">LinkedIn URL</label>
                                    <Input placeholder="https://linkedin.com/posts/... or /in/username" />
                                </div>
                                <div className="w-full md:w-[250px] space-y-2">
                                    <label className="text-sm font-medium">Mode</label>
                                    <Select defaultValue="search_posts">
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select mode" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="search_posts">Find top posts from profile</SelectItem>
                                            <SelectItem value="scrape_post">Scrape specific post directly</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button onClick={handleSearchPosts}>Search Posts</Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Job Outreach Tab */}
                <TabsContent value="jobs" className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Target Parameters</CardTitle>
                                <CardDescription>Define who to reach — AI will validate inputs</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Industries</label>
                                    <div className="flex gap-2">
                                        <Select>
                                            <SelectTrigger className="flex-1">
                                                <SelectValue placeholder="— Select industry —" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="104">Staffing & Recruiting</SelectItem>
                                                <SelectItem value="4">Computer Software</SelectItem>
                                                <SelectItem value="96">Information Technology</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Button variant="outline">Add</Button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Locations</label>
                                    <div className="flex gap-2">
                                        <Input placeholder="e.g. United States" className="flex-1" />
                                        <Button variant="outline">Add</Button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Target Job Titles</label>
                                    <div className="flex gap-2">
                                        <Input placeholder="e.g. CEO, Founder" className="flex-1" />
                                        <Button variant="outline">Add</Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Niche Keywords</label>
                                        <Input placeholder="recruiting, hiring" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Exclude</label>
                                        <Input placeholder="finance, legal" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Seniority</label>
                                        <Select defaultValue="exec">
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">All levels</SelectItem>
                                                <SelectItem value="exec">Executive</SelectItem>
                                                <SelectItem value="mgr">Manager</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Limits</label>
                                        <Input type="number" defaultValue={20} />
                                    </div>
                                </div>

                                <Button className="w-full mt-4" onClick={aiSuggestParams}>
                                    <Zap className="mr-2 h-4 w-4" /> AI Validate Parameters
                                </Button>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Campaign Summary</CardTitle>
                                <CardDescription>Review before launching</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-border rounded-lg bg-muted/30">
                                    <Target className="h-10 w-10 mb-3 text-muted-foreground opacity-50" />
                                    <p className="text-sm text-muted-foreground">Configure parameters on the left, then click "AI Validate Parameters" to see the suggestion.</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Queue Tab */}
                <TabsContent value="queue" className="space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-4">
                            <div>
                                <CardTitle>DM Review Queue</CardTitle>
                                <CardDescription>Review, edit, and approve generated DMs before sending.</CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm">✓ Approve All &ge; 6.5</Button>
                                <Button size="sm">Send Approved (0)</Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-2 border-b border-border pb-4 mb-4">
                                <Badge variant="outline" className="cursor-pointer bg-primary/10 text-primary border-primary">All</Badge>
                                <Badge variant="outline" className="cursor-pointer">Pending</Badge>
                                <Badge variant="outline" className="cursor-pointer">Approved</Badge>
                                <Badge variant="outline" className="cursor-pointer">Flagged</Badge>
                            </div>

                            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground border border-border rounded-lg bg-card">
                                <Mail className="h-12 w-12 mb-4 opacity-20" />
                                <p>No DMs in queue yet</p>
                                <p className="text-sm mt-1">Generate DMs from Content or Job tabs.</p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Settings Tab */}
                <TabsContent value="settings" className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>n8n Configuration</CardTitle>
                                <CardDescription>Backend webhook URLs</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">n8n Base URL</label>
                                    <Input defaultValue="https://n8n.prasidha.me" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Content Webhook</label>
                                    <Input defaultValue="/webhook/outreach-intercept" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Job Webhook</label>
                                    <Input defaultValue="/webhook/8763f04c-764a-41aa-944d-c0782a26f3db" />
                                </div>
                                <Button>Save Configuration</Button>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>DM Quality Settings</CardTitle>
                                <CardDescription>Controls auto-approval limits</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Auto-approve threshold (1-10)</label>
                                    <Input type="number" defaultValue={6.5} step={0.5} />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Max regeneration attempts</label>
                                    <Input type="number" defaultValue={2} />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Connection limits / day</label>
                                    <Input type="number" defaultValue={20} />
                                </div>
                                <Button>Save Settings</Button>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default OutreachEngine;
