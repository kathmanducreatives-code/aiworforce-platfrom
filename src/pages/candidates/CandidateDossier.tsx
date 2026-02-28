import { useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, Play, Star, Video, Download, X, Search, FileText, Check } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Shield } from 'lucide-react'; // Added Shield import

const CandidateDossier = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'overview' | 'verification' | 'interview'>('overview');

    // Drawer state
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [selectedExpert, setSelectedExpert] = useState<number | null>(null);

    const isVerified = true; // Mock state
    const hasInterview = false; // Set to false to show the Request Interview CTA

    return (
        <div className="min-h-screen bg-bg-deepest text-text-primary pb-20 font-display">
            {/* Top Nav */}
            <div className="sticky top-0 z-40 bg-bg-deepest/90 backdrop-blur-xl border-b border-border-subtle">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors text-sm font-medium"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Candidates
                    </button>
                    <div className="flex items-center gap-3">
                        <button className="px-4 py-2 rounded-lg bg-bg-surface border border-border-subtle hover:border-danger hover:text-danger hover:bg-danger/10 text-text-secondary transition-all text-sm font-medium">
                            <X className="w-3.5 h-3.5 inline-block mr-1" /> Pass
                        </button>
                        <button className="px-4 py-2 rounded-lg bg-verified/10 border border-verified/30 text-verified hover:bg-verified/20 transition-all text-sm font-medium flex items-center gap-2 shadow-[0_0_15px_rgba(0,212,170,0.1)]">
                            <Star className="w-4 h-4 fill-verified" />
                            Shortlist
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 pt-8">
                {/* Header Section */}
                <div className="flex flex-col lg:flex-row gap-8 mb-10">

                    {/* Profile Info */}
                    <div className="flex-1 flex gap-6 items-center">
                        <div className="w-24 h-24 rounded-2xl bg-bg-surface border border-border-subtle overflow-hidden flex-shrink-0 relative">
                            <img src={`https://i.pravatar.cc/150?u=${id || 'sarah'}`} alt="Candidate" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-t from-bg-deepest/80 to-transparent"></div>
                        </div >
                        <div>
                            <h1 className="text-3xl font-bold text-text-primary mb-1">Sarah Chen</h1>
                            <p className="text-lg text-text-secondary mb-3">Senior Frontend Developer</p>
                            <div className="flex flex-wrap items-center gap-3 text-sm text-text-dim">
                                <span className="flex items-center gap-1.5"><span className="text-verified">🌍</span> Helsinki, Finland</span>
                                <span>•</span>
                                <span>4 weeks notice</span>
                                <span>•</span>
                                <span className="flex items-center gap-1.5 font-mono">💰 €75,000 expected</span>
                                <span>•</span>
                                <span>🏠 Hybrid preferred</span>
                            </div>
                        </div>
                    </div >

                    {/* 4 Score Cards */}
                    < div className="flex gap-4 overflow-x-auto pb-4 lg:pb-0 hide-scrollbar" >

                        {/* AI Score Card */}
                        < div className="w-[160px] h-[120px] rounded-xl bg-bg-surface border border-border-subtle p-4 flex flex-col items-center justify-center relative flex-shrink-0 group hover:border-border-hover transition-colors" >
                            <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest absolute top-3 left-3">AI Score</p>
                            <div className="relative w-14 h-14 mt-4 flex items-center justify-center">
                                <svg className="w-full h-full -rotate-90 absolute inset-0" viewBox="0 0 36 36">
                                    <circle cx="18" cy="18" r="16" fill="none" className="stroke-bg-elevated" strokeWidth="3"></circle>
                                    <circle cx="18" cy="18" r="16" fill="none" className="stroke-verified transition-all duration-1000 ease-out" strokeWidth="3" strokeDasharray="100 100" strokeDashoffset="8" strokeLinecap="round"></circle>
                                </svg>
                                <span className="font-mono text-xl font-bold text-text-primary">92%</span>
                            </div>
                            <p className="text-[11px] font-medium text-verified uppercase mt-2">Excellent</p>
                        </div >

                        {/* Verified Card */}
                        < div className="w-[160px] h-[120px] rounded-xl bg-bg-surface border border-border-subtle p-4 flex flex-col items-center justify-center relative flex-shrink-0 group hover:border-border-hover transition-colors" >
                            <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest absolute top-3 left-3">Verified</p>
                            <div className="w-12 h-12 rounded-full bg-verified/10 mt-3 flex items-center justify-center mb-2">
                                <CheckCircle2 className="w-6 h-6 text-verified" />
                            </div>
                            <p className="font-mono text-sm font-semibold text-text-primary">4/4 Passed</p>
                            <p className="text-[11px] text-text-dim mt-0.5">All Clear</p>
                        </div >

                        {/* Interview Card */}
                        < div className="w-[160px] h-[120px] rounded-xl bg-bg-surface border border-border-subtle p-4 flex flex-col items-center justify-center relative flex-shrink-0 group hover:border-border-hover transition-colors" >
                            <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest absolute top-3 left-3">Interview</p>
                            <div className="flex items-baseline gap-1 mt-4">
                                <span className="font-mono text-3xl font-bold text-info border-b border-info/30 pb-1">8.5</span>
                                <span className="font-mono text-sm text-text-dim">/10</span>
                            </div>
                            <p className="text-[11px] font-medium text-info uppercase mt-3">Strong Hire</p>
                        </div >

                        {/* Status Card */}
                        < div className="w-[160px] h-[120px] rounded-xl bg-verified/5 border border-verified/20 p-4 flex flex-col items-center justify-center relative flex-shrink-0 group hover:bg-verified/10 transition-colors" >
                            <p className="text-[10px] font-semibold text-verified/70 uppercase tracking-widest absolute top-3 left-3">Status</p>
                            <div className="mt-4 text-center">
                                <p className="text-lg font-bold text-verified mb-1">Shortlisted</p>
                                <div className="flex items-center justify-center gap-1.5 bg-verified/10 px-2 py-0.5 rounded text-xs font-medium text-verified border border-verified/20">
                                    <Star className="w-3 h-3 fill-verified" />
                                    Top 3
                                </div>
                            </div>
                        </div >

                    </div >
                </div >

                {/* Tab Navigation */}
                < div className="flex items-center gap-8 border-b border-border-subtle mb-8" >
                    {
                        [
                            { id: 'overview', label: 'Overview' },
                            { id: 'verification', label: 'Verification' },
                            { id: 'interview', label: 'Interview' },
                            { id: 'ai-screening', label: 'AI Screening' },
                            { id: 'timeline', label: 'Timeline' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as 'overview' | 'verification' | 'interview')}
                                className={`pb-4 text-sm font-medium transition-all relative ${activeTab === tab.id ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                            >
                                {tab.label}
                                {activeTab === tab.id && (
                                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-verified rounded-t-full" />
                                )}
                            </button>
                        ))
                    }
                </div >

                {/* Tab Content Area */}
                < div className="min-h-[500px]" >

                    {/* OVERVIEW TAB */}
                    {
                        activeTab === 'overview' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {/* Quick Facts */}
                                <div>
                                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-4">Quick Facts</h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-bg-surface border border-border-subtle rounded-xl p-5 hover:border-border-hover transition-colors">
                                            <h3 className="text-text-primary font-medium mb-3">Experience</h3>
                                            <ul className="space-y-2 text-sm text-text-secondary">
                                                <li className="flex items-start gap-2"><span className="text-verified mt-0.5">•</span> 8 years frontend</li>
                                                <li className="flex items-start gap-2"><span className="text-verified mt-0.5">•</span> 3 years React/Next.js</li>
                                                <li className="flex items-start gap-2"><span className="text-verified mt-0.5">•</span> 2 years team lead</li>
                                            </ul>
                                        </div>
                                        <div className="bg-bg-surface border border-border-subtle rounded-xl p-5 hover:border-border-hover transition-colors">
                                            <h3 className="text-text-primary font-medium mb-3">Education</h3>
                                            <ul className="space-y-2 text-sm text-text-secondary mb-3">
                                                <li>BSc Computer Science</li>
                                                <li>TU Helsinki, 2018</li>
                                            </ul>
                                            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-verified/10 text-verified rounded text-xs font-medium border border-verified/20">
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Degree Verified
                                            </div>
                                        </div>
                                        <div className="bg-bg-surface border border-border-subtle rounded-xl p-5 hover:border-border-hover transition-colors">
                                            <h3 className="text-text-primary font-medium mb-3">Compensation</h3>
                                            <ul className="space-y-2 text-sm text-text-secondary">
                                                <li className="flex justify-between"><span>Expects:</span> <span className="text-text-primary font-mono">€75,000</span></li>
                                                <li className="flex justify-between items-center">
                                                    <span>Budget:</span>
                                                    <span className="flex items-center gap-1 text-text-primary font-mono">€70-80k <CheckCircle2 className="w-3.5 h-3.5 text-verified" /></span>
                                                </li>
                                                <li className="flex justify-between"><span>Equity:</span> <span className="text-text-primary">Interested</span></li>
                                            </ul>
                                        </div>
                                        <div className="bg-bg-surface border border-border-subtle rounded-xl p-5 hover:border-border-hover transition-colors">
                                            <h3 className="text-text-primary font-medium mb-3">Availability</h3>
                                            <ul className="space-y-2 text-sm text-text-secondary">
                                                <li className="flex items-center gap-2"><span>📅</span> 4 weeks notice</li>
                                                <li className="flex items-center gap-2"><span>🏠</span> Hybrid (2d office)</li>
                                                <li className="flex items-center gap-2"><span>🌍</span> Helsinki based</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                {/* Expert Interviewer Recommendation */}
                                <div>
                                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-4">Expert Interviewer's Recommendation</h2>
                                    <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 relative overflow-hidden group hover:border-border-hover transition-colors">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-verified"></div>
                                        <p className="text-text-primary text-lg leading-relaxed italic mb-6">
                                            "Sarah is one of the strongest frontend candidates I've interviewed this quarter. Deep React expertise, built Wolt's checkout flow serving 2M users. Only concern: limited backend experience, but she's aware and actively upskilling. <strong className="text-verified">Strong hire.</strong>"
                                        </p>
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center font-bold text-sm text-text-primary">M</div>
                                            <div>
                                                <p className="text-sm font-medium text-text-primary">Marcus Lindqvist</p>
                                                <p className="text-xs text-text-dim flex items-center gap-1">Technical Interviewer • <Star className="w-3 h-3 fill-warning text-warning" /> 4.8</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* AI-Detected Highlights */}
                                <div>
                                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-4">AI-Detected Highlights From Interview</h2>
                                    <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
                                        {[
                                            { time: '03:42', type: 'positive', text: 'Strongest technical answer — React architecture' },
                                            { time: '12:15', type: 'positive', text: 'Salary discussion — firm on €75k, open to equity' },
                                            { time: '18:30', type: 'positive', text: 'Explained career gap — 3-month sabbatical in Japan' },
                                            { time: 'warning', isWarning: true, text: 'Hesitated on backend system design question', actualTime: '24:10' },
                                            { time: '31:45', type: 'positive', text: 'Great culture fit — values autonomy and ownership' },
                                            { time: '38:20', type: 'positive', text: 'Confirmed 4-week notice, no competing offers' },
                                        ].map((highlight, i) => (
                                            <button key={i} className={`w-full flex items-center gap-4 p-4 text-left border-b border-border-subtle hover:bg-bg-elevated transition-colors group ${i === 5 ? 'border-b-0' : ''}`}>
                                                <div className={`w-1 h-8 rounded-full ${highlight.isWarning ? 'bg-warning' : 'bg-verified'}`}></div>
                                                <div className="flex items-center gap-2 w-24 flex-shrink-0 text-info font-mono text-sm opacity-80 group-hover:opacity-100 transition-opacity">
                                                    <Play className="w-3 h-3" /> {highlight.actualTime || highlight.time}
                                                </div>
                                                <p className="text-text-primary text-sm flex-1">{highlight.text}</p>
                                                <span className="text-xs text-info opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                                    Jump to <ChevronRight className="w-3 h-3" />
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="pt-4 flex flex-wrap gap-3">
                                    {hasInterview ? (
                                        <button onClick={() => setActiveTab('interview')} className="px-5 py-2.5 rounded-lg bg-verified text-bg-deepest font-semibold hover:bg-verified/90 transition-all flex items-center gap-2 shadow-[0_4px_14px_rgba(0,212,170,0.3)]">
                                            <Play className="w-4 h-4 fill-bg-deepest" />
                                            Watch Full Interview
                                        </button>
                                    ) : (
                                        <button onClick={() => setIsDrawerOpen(true)} className="px-5 py-2.5 rounded-lg bg-premium text-white font-semibold hover:bg-premium/90 transition-all flex items-center gap-2 shadow-[0_4px_14px_rgba(167,139,250,0.3)]">
                                            <Video className="w-4 h-4" />
                                            Request Expert Interview
                                        </button>
                                    )}
                                    <button className="px-5 py-2.5 rounded-lg bg-bg-surface border border-border-subtle hover:border-info hover:text-info text-text-primary transition-all flex items-center gap-2 font-medium">
                                        <Download className="w-4 h-4" />
                                        Download Report
                                    </button>
                                    <button className="px-5 py-2.5 rounded-lg bg-bg-surface border border-border-subtle hover:border-verified hover:text-verified text-text-primary transition-all flex items-center gap-2 font-medium">
                                        <Video className="w-4 h-4" />
                                        Schedule Final Round
                                    </button>
                                </div>
                            </div>
                        )
                    }

                    {/* VERIFICATION TAB */}
                    {
                        activeTab === 'verification' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="flex items-center justify-between mb-2">
                                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Verification Results</h2>
                                    <span className="text-sm text-text-dim font-mono">Completed: Feb 26, 2026</span>
                                </div>

                                {/* Degree */}
                                <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden relative group hover:border-border-hover transition-colors">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-verified"></div>
                                    <div className="p-5">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="w-5 h-5 text-verified" />
                                                <h3 className="text-text-primary font-bold tracking-wide uppercase">Degree — BSc Computer Science</h3>
                                            </div>
                                            <span className="px-2 py-1 bg-verified/10 text-verified rounded text-[10px] font-bold tracking-widest uppercase border border-verified/20">Verified</span>
                                        </div>
                                        <div className="pl-7 space-y-1">
                                            <p className="text-text-primary font-medium">BSc Computer Science</p>
                                            <p className="text-text-secondary text-sm">TU Helsinki · Graduated 2018</p>
                                            <p className="text-text-dim text-xs mt-2 font-mono">Verified via: VIRTA (Finnish Higher Education Registry)</p>
                                            <p className="text-text-dim text-xs font-mono">Verified on: Feb 25, 2026</p>
                                            <div className="mt-4 flex items-center gap-2">
                                                <FileText className="w-4 h-4 text-text-secondary" />
                                                <span className="text-sm text-text-secondary">Certificate uploaded</span>
                                                <button className="text-sm text-info hover:underline ml-2">View Document</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Employment 1 */}
                                <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden relative group hover:border-border-hover transition-colors">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-verified"></div>
                                    <div className="p-5">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="w-5 h-5 text-verified" />
                                                <h3 className="text-text-primary font-bold tracking-wide uppercase">Employment — Wolt (2020-2023)</h3>
                                            </div>
                                            <span className="px-2 py-1 bg-verified/10 text-verified rounded text-[10px] font-bold tracking-widest uppercase border border-verified/20">Verified</span>
                                        </div>
                                        <div className="pl-7 space-y-1">
                                            <p className="text-text-primary font-medium">Role: Senior Frontend Developer</p>
                                            <p className="text-text-secondary text-sm">Duration: Jan 2020 — Nov 2023 (3 years 11 months)</p>
                                            <p className="text-text-dim text-xs mt-2 font-mono">Verified via: HR department confirmation</p>
                                            <p className="text-text-dim text-xs font-mono">Verified on: Feb 25, 2026</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Certification */}
                                <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden relative group hover:border-border-hover transition-colors">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-verified"></div>
                                    <div className="p-5">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="w-5 h-5 text-verified" />
                                                <h3 className="text-text-primary font-bold tracking-wide uppercase">Certification — AWS Solutions Architect</h3>
                                            </div>
                                            <span className="px-2 py-1 bg-verified/10 text-verified rounded text-[10px] font-bold tracking-widest uppercase border border-verified/20">Verified</span>
                                        </div>
                                        <div className="pl-7 space-y-1">
                                            <p className="text-text-primary font-medium">Issued: March 2024 · Expires: March 2027</p>
                                            <p className="text-text-dim text-xs mt-2 font-mono">Verified via: AWS Certification Validation Portal</p>
                                            <p className="text-text-dim text-xs font-mono">Credential ID: AWS-SA-2024-XXXXX</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Resume Consistency */}
                                <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden relative group hover:border-border-hover transition-colors">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-info"></div>
                                    <div className="p-5">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <Search className="w-5 h-5 text-info" />
                                                <h3 className="text-text-primary font-bold tracking-wide uppercase">Resume Consistency Check</h3>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="relative w-8 h-8">
                                                    <svg className="w-full h-full -rotate-90 absolute inset-0" viewBox="0 0 36 36">
                                                        <circle cx="18" cy="18" r="16" fill="none" className="stroke-bg-elevated" strokeWidth="4"></circle>
                                                        <circle cx="18" cy="18" r="16" fill="none" className="stroke-info" strokeWidth="4" strokeDasharray="100 100" strokeDashoffset="2" strokeLinecap="round"></circle>
                                                    </svg>
                                                </div>
                                                <span className="font-mono text-info font-bold">98% Match</span>
                                            </div>
                                        </div>
                                        <div className="pl-7 space-y-2">
                                            <p className="text-text-secondary text-sm mb-3">LinkedIn profile vs uploaded CV:</p>
                                            <div className="flex items-start gap-2 text-sm text-text-primary">
                                                <CheckCircle2 className="w-4 h-4 text-verified mt-0.5" /> Job titles match
                                            </div>
                                            <div className="flex items-start gap-2 text-sm text-text-primary">
                                                <CheckCircle2 className="w-4 h-4 text-verified mt-0.5" /> Employment dates match
                                            </div>
                                            <div className="flex items-start gap-2 text-sm text-text-primary">
                                                <CheckCircle2 className="w-4 h-4 text-verified mt-0.5" /> Education matches
                                            </div>
                                            <div className="flex items-start gap-2 text-sm text-text-primary mt-2 p-3 bg-warning/5 border border-warning/20 rounded-lg">
                                                <span className="text-warning mt-0.5">⚠️</span>
                                                <div>
                                                    <p>Minor: LinkedIn says "Lead Developer", CV says "Frontend Lead"</p>
                                                    <p className="text-text-dim text-xs mt-1">(likely same role, different phrasing — <strong className="text-verified">LOW RISK</strong>)</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        )
                    }

                    {/* INTERVIEW TAB */}
                    {
                        activeTab === 'interview' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

                                {!hasInterview ? (
                                    <div className="bg-bg-surface border border-border-subtle rounded-xl p-12 text-center">
                                        <div className="w-16 h-16 rounded-full bg-premium/10 flex items-center justify-center mx-auto mb-6">
                                            <Video className="w-8 h-8 text-premium" />
                                        </div>
                                        <h3 className="text-xl font-bold text-text-primary mb-2">Technical Interview Required</h3>
                                        <p className="text-text-secondary max-w-md mx-auto mb-8">Sarah has passed the primary AI screen, but we recommend a 45-minute technical deep dive with a vetted Senior React Engineer before moving to final rounds.</p>
                                        <button onClick={() => setIsDrawerOpen(true)} className="px-6 py-3 rounded-xl bg-premium text-white font-bold hover:bg-premium/90 transition-all flex items-center gap-2 mx-auto shadow-[0_4px_20px_rgba(167,139,250,0.4)] hover:shadow-[0_4px_25px_rgba(167,139,250,0.6)]">
                                            <Video className="w-5 h-5" />
                                            Request Expert Interview
                                        </button>
                                        <p className="text-text-dim text-sm mt-4 font-mono">€90 Escrow · 24h Turnaround</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center justify-between mb-2">
                                            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Expert Interview</h2>
                                            <span className="text-sm text-text-dim font-mono">Conducted: Feb 27, 2026</span>
                                        </div>

                                        {/* Video Player */}
                                        <div className="bg-bg-deepest border border-border-subtle rounded-xl overflow-hidden aspect-video relative group shadow-[0_4px_30px_rgba(0,0,0,0.5)] hover:shadow-[0_0_40px_rgba(0,212,170,0.05)] transition-shadow">
                                            <img src="https://images.unsplash.com/photo-1573164713988-8665fc963095?auto=format&fit=crop&q=80&w=1600" alt="Video Placeholder" className="w-full h-full object-cover opacity-60" />
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <div className="w-16 h-16 rounded-full bg-verified/20 backdrop-blur-md flex items-center justify-center border border-verified/30 cursor-pointer hover:scale-110 transition-transform">
                                                    <Play className="w-6 h-6 text-verified ml-1 fill-verified" />
                                                </div>
                                            </div>
                                            {/* Custom Video Controls */}
                                            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent">
                                                <div className="flex items-center gap-4 text-white font-mono text-sm mb-2">
                                                    <Play className="w-4 h-4" />
                                                    <span>00:00 / 42:18</span>
                                                </div>
                                                {/* Progress bar with markers */}
                                                <div className="h-1.5 w-full bg-white/20 rounded-full relative group/bar cursor-pointer">
                                                    <div className="absolute top-0 left-0 h-full bg-verified rounded-full w-[15%]"></div>
                                                    {/* Markers */}
                                                    {[3.5, 12.2, 18.5, 24.1, 31.7, 38.3].map((pos, i) => (
                                                        <div key={i} className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${i === 3 ? 'bg-warning' : 'bg-info'} border-2 border-black`} style={{ left: `${(pos / 42.3) * 100}%` }}></div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Two Column Section */}
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                                            {/* Expert Scorecard */}
                                            <div className="bg-bg-surface border border-border-subtle rounded-xl p-6">
                                                <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">Expert Scorecard</h3>
                                                <div className="space-y-5">
                                                    {[
                                                        { label: 'Technical Depth', score: 9, color: 'verified' },
                                                        { label: 'Communication', score: 8, color: 'info' },
                                                        { label: 'Problem Solving', score: 9, color: 'verified' },
                                                        { label: 'Culture Fit', score: 8, color: 'info' },
                                                        { label: 'Leadership', score: 7, color: 'warning' }
                                                    ].map(skill => (
                                                        <div key={skill.label}>
                                                            <div className="flex justify-between text-sm mb-1.5 font-medium">
                                                                <span className="text-text-primary">{skill.label}</span>
                                                                <span className="font-mono text-text-secondary">{skill.score}/10</span>
                                                            </div>
                                                            <div className="h-2.5 w-full bg-bg-elevated rounded-full overflow-hidden">
                                                                <div className={`h-full bg-${skill.color} rounded-full`} style={{ width: `${skill.score * 10}%` }}></div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <div className="pt-4 mt-4 border-t border-border-subtle flex justify-between items-center">
                                                        <span className="text-text-secondary font-medium uppercase tracking-wider text-sm">Overall</span>
                                                        <div className="text-right">
                                                            <span className="font-mono text-2xl font-bold text-info">8.5/10</span>
                                                            <p className="text-xs font-semibold text-info uppercase tracking-widest">Strong Hire</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* AI Analysis */}
                                            <div className="bg-bg-surface border border-border-subtle rounded-xl p-6">
                                                <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">AI Analysis</h3>

                                                <div className="grid grid-cols-2 gap-4 mb-6">
                                                    <div className="bg-bg-deepest rounded-lg p-3 border border-border-subtle">
                                                        <p className="text-xs text-text-dim uppercase tracking-wider mb-1">Confidence</p>
                                                        <p className="text-verified font-mono font-bold">HIGH</p>
                                                    </div>
                                                    <div className="bg-bg-deepest rounded-lg p-3 border border-border-subtle">
                                                        <p className="text-xs text-text-dim uppercase tracking-wider mb-1">Pace</p>
                                                        <p className="text-info font-mono font-bold">NORMAL</p>
                                                    </div>
                                                    <div className="bg-bg-deepest rounded-lg p-3 border border-border-subtle">
                                                        <p className="text-xs text-text-dim uppercase tracking-wider mb-1">Hesitations</p>
                                                        <p className="text-warning font-mono font-bold">3 detected</p>
                                                    </div>
                                                    <div className="bg-bg-deepest rounded-lg p-3 border border-border-subtle">
                                                        <p className="text-xs text-text-dim uppercase tracking-wider mb-1">Enthusiasm</p>
                                                        <p className="text-verified font-mono font-bold">HIGH</p>
                                                    </div>
                                                </div>

                                                <h4 className="text-sm font-medium text-text-primary mb-3">Key Topics Discussed</h4>
                                                <ul className="space-y-2 text-sm text-text-secondary mb-6">
                                                    <li>• React architecture & performance</li>
                                                    <li>• Team leadership and mentoring</li>
                                                    <li>• Salary expectations and equity</li>
                                                </ul>

                                                <div className="p-4 bg-info/5 border border-info/20 rounded-lg">
                                                    <p className="text-sm text-text-secondary">
                                                        <strong className="text-info">Sentiment:</strong> Positive throughout, slight anxiety detected at 24:10 on backend architecture questions.
                                                    </p>
                                                </div>
                                            </div>

                                        </div>

                                        {/* Expert Written Report */}
                                        <div className="bg-bg-surface border border-border-subtle rounded-xl p-6">
                                            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-4">Expert's Written Report</h3>
                                            <div className="flex items-center gap-3 mb-4">
                                                <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center font-bold text-sm text-text-primary">M</div>
                                                <div>
                                                    <p className="text-sm font-medium text-text-primary">Marcus Lindqvist</p>
                                                    <p className="text-xs text-text-dim flex items-center gap-1">Technical Interviewer • <Star className="w-3 h-3 fill-warning text-warning" /> 4.8 (47 interviews)</p>
                                                </div>
                                            </div>
                                            <p className="text-text-secondary leading-relaxed text-sm mb-4">
                                                "Sarah demonstrated exceptional frontend architecture knowledge. She walked me through Wolt's checkout system redesign, handling 2M+ monthly transactions, with clear articulation of trade-offs she made between performance and maintainability. Her React fundamentals are flawless. The only gap was backend system design, but this is expected for a deeply specialized frontend role."
                                            </p>
                                            <button className="text-sm font-medium text-info hover:text-info/80 transition-colors">Read Full Report ↓</button>
                                        </div>

                                        {/* Searchable Transcript */}
                                        <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
                                            <div className="p-4 border-b border-border-subtle flex items-center justify-between bg-bg-elevated/50">
                                                <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Transcript</h3>
                                                <div className="relative">
                                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
                                                    <input type="text" placeholder="Search transcript..." className="bg-bg-deepest border border-border-subtle rounded-md pl-9 pr-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-verified transition-colors w-64" />
                                                </div>
                                            </div>
                                            <div className="p-6 max-h-96 overflow-y-auto space-y-4 font-sans text-sm">
                                                <div className="flex gap-4 hover:bg-bg-elevated/50 p-2 -mx-2 rounded transition-colors cursor-pointer border-l-2 border-transparent">
                                                    <span className="font-mono text-info/70 flex-shrink-0">00:00</span>
                                                    <p><strong className="text-text-primary">Marcus:</strong> <span className="text-text-secondary">Hi Sarah, thanks for taking the time today.</span></p>
                                                </div>
                                                <div className="flex gap-4 hover:bg-bg-elevated/50 p-2 -mx-2 rounded transition-colors cursor-pointer border-l-2 border-transparent">
                                                    <span className="font-mono text-info/70 flex-shrink-0">00:15</span>
                                                    <p><strong className="text-text-primary">Sarah:</strong> <span className="text-text-secondary">Happy to be here, thanks for setting this up.</span></p>
                                                </div>
                                                <div className="flex gap-4 bg-verified/5 p-2 -mx-2 rounded transition-colors cursor-pointer border-l-2 border-verified">
                                                    <span className="font-mono text-verified flex-shrink-0">03:42</span>
                                                    <p><strong className="text-text-primary">Marcus:</strong> <span className="text-text-secondary">Let's talk about the Wolt checkout redesign. How did you handle state management across those complex flows?</span></p>
                                                </div>
                                                <div className="flex gap-4 hover:bg-bg-elevated/50 p-2 -mx-2 rounded transition-colors cursor-pointer border-l-2 border-transparent">
                                                    <span className="font-mono text-info/70 flex-shrink-0">03:55</span>
                                                    <p><strong className="text-text-primary">Sarah:</strong> <span className="text-text-secondary">We actually moved away from global Redux for that specific flow and utilized React Context with localized reducers. The performance gain was significant because...</span></p>
                                                </div>
                                                <div className="flex gap-4 hover:bg-bg-elevated/50 p-2 -mx-2 rounded transition-colors cursor-pointer border-l-2 border-transparent">
                                                    <span className="font-mono text-info/70 flex-shrink-0">12:15</span>
                                                    <p><strong className="text-text-primary">Marcus:</strong> <span className="text-text-secondary">And regarding compensation, the role is budgeted up to €80k. Where do your expectations sit?</span></p>
                                                </div>
                                                <div className="flex gap-4 hover:bg-bg-elevated/50 p-2 -mx-2 rounded transition-colors cursor-pointer border-l-2 border-transparent">
                                                    <span className="font-mono text-info/70 flex-shrink-0">12:20</span>
                                                    <p><strong className="text-text-primary">Sarah:</strong> <span className="text-text-secondary">I'm comfortable at €75,000 as a base, assuming there's an equity component involved.</span></p>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )
                    }

                </div >

            </div >

            {/* Drawer Overlay */}
            {
                isDrawerOpen && (
                    <div className="fixed inset-0 bg-bg-deepest/80 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-300">
                        <div className="w-[500px] max-w-full bg-bg-surface h-full border-l border-border-subtle shadow-[-10px_0_40px_rgba(0,0,0,0.5)] flex flex-col animate-in slide-in-from-right duration-300">
                            {/* Drawer Header */}
                            <div className="p-6 border-b border-border-subtle flex items-center justify-between">
                                <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
                                    <Video className="w-5 h-5 text-premium" />
                                    Request Expert Interview
                                </h2>
                                <button onClick={() => setIsDrawerOpen(false)} className="text-text-dim hover:text-text-primary p-2 hover:bg-bg-elevated rounded-lg transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Wizard Progress */}
                            <div className="px-6 pt-6 pb-2">
                                <div className="flex relative">
                                    <div className="absolute top-1/2 -mt-[1px] left-0 w-full h-[2px] bg-bg-elevated -z-10">
                                        <div className="h-full bg-premium transition-all duration-500" style={{ width: `${((wizardStep - 1) / 2) * 100}%` }}></div>
                                    </div>
                                    {[1, 2, 3].map(step => (
                                        <div key={step} className={`flex-1 flex justify-center`}>
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors duration-300 bg-bg-surface ${step < wizardStep ? 'border-premium bg-premium text-white' : step === wizardStep ? 'border-premium text-premium' : 'border-bg-elevated text-text-dim'}`}>
                                                {step < wizardStep ? <Check className="w-4 h-4" /> : step}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between text-xs text-text-secondary font-medium tracking-wide mt-3 px-4">
                                    <span>Interviewer</span>
                                    <span>Focus</span>
                                    <span>Payment</span>
                                </div>
                            </div>

                            {/* Drawer Scrollable Content */}
                            <div className="flex-1 overflow-y-auto p-6 font-display">

                                {/* STEP 1: Select Interviewer */}
                                {wizardStep === 1 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                        <p className="text-text-secondary mb-2">Select a vetted expert to conduct the technical interview for <strong className="text-text-primary">Sarah Chen</strong>.</p>

                                        {[
                                            { id: 1, name: 'Marcus Lindqvist', title: 'Senior React Dev @ Spotify', rating: 4.8, count: 47, skills: ['React', 'Next.js', 'System Design'] },
                                            { id: 2, name: 'Elena Rostova', title: 'Staff Engineer @ Stripe', rating: 4.9, count: 112, skills: ['Frontend Arch', 'TypeScript', 'Node.js'] },
                                            { id: 3, name: 'David Kim', title: 'VPE @ Vercel', rating: 4.9, count: 86, skills: ['Next.js', 'Team Leadership', 'Culture'] }
                                        ].map(expert => (
                                            <button
                                                key={expert.id}
                                                onClick={() => setSelectedExpert(expert.id)}
                                                className={`w-full text-left p-4 rounded-xl border transition-all ${selectedExpert === expert.id ? 'bg-premium/10 border-premium/50 shadow-[0_0_20px_rgba(167,139,250,0.15)] ring-1 ring-premium' : 'bg-bg-deepest border-border-subtle hover:border-border-hover hover:bg-bg-elevated'}`}
                                            >
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex gap-3 items-center">
                                                        <div className="w-10 h-10 rounded-full bg-surface overflow-hidden border border-border-subtle">
                                                            <img src={`https://i.pravatar.cc/150?u=${expert.id + 10}`} alt={expert.name} />
                                                        </div>
                                                        <div>
                                                            <h4 className="font-bold text-text-primary text-sm">{expert.name}</h4>
                                                            <p className="text-xs text-text-dim">{expert.title}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs font-mono font-medium">
                                                        <Star className="w-3.5 h-3.5 text-warning fill-warning" />
                                                        <span className="text-text-primary">{expert.rating}</span>
                                                        <span className="text-text-dim">({expert.count})</span>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 flex-wrap ml-13 pl-[52px]">
                                                    {expert.skills.map(skill => (
                                                        <span key={skill} className="px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-widest uppercase bg-bg-elevated text-text-secondary border border-border-subtle">
                                                            {skill}
                                                        </span>
                                                    ))}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* STEP 2: Focus Areas */}
                                {wizardStep === 2 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                        <p className="text-text-secondary mb-4">What should the interviewer focus on during this 45-minute session?</p>

                                        <div className="space-y-3">
                                            {[
                                                { id: 'react', label: 'React / Next.js Architecture', desc: 'Deep dive into rendering strategies, state management, and SSR.' },
                                                { id: 'system', label: 'Frontend System Design', desc: 'Architecture, scalable CSS, monorepos, and build tools.' },
                                                { id: 'leadership', label: 'Cross-functional Leadership', desc: 'Mentoring, pushing back on product requirements, communication.' },
                                                { id: 'salary', label: 'Compensation Alignment', desc: 'Confirm expectations around base salary and equity.' }
                                            ].map(focus => (
                                                <label key={focus.id} className="flex gap-3 p-4 bg-bg-deepest border border-border-subtle rounded-xl cursor-pointer hover:border-border-hover group transition-colors">
                                                    <div className="pt-1">
                                                        <input type="checkbox" className="w-4 h-4 rounded appearance-none border border-border-subtle checked:bg-premium checked:border-premium flex items-center justify-center after:content-['✓'] after:hidden checked:after:block after:text-white after:text-xs text-center" defaultChecked />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-text-primary text-sm group-hover:text-premium transition-colors">{focus.label}</h4>
                                                        <p className="text-xs text-text-dim mt-1 leading-relaxed">{focus.desc}</p>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>

                                        <div>
                                            <h4 className="font-bold text-text-primary text-sm mb-2 mt-6">Custom Instructions</h4>
                                            <textarea className="w-full bg-bg-deepest border border-border-subtle rounded-xl p-3 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-premium focus:ring-1 focus:ring-premium resize-none h-24" placeholder="E.g., Please ask about her experience migrating from Vue to React at her last job..."></textarea>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 3: Payment Confirmation */}
                                {wizardStep === 3 && (
                                    <div className="animate-in fade-in slide-in-from-right-4 h-full flex flex-col justify-center">

                                        <div className="bg-bg-deepest border border-premium/30 rounded-2xl p-6 text-center mb-6 relative overflow-hidden shadow-[0_0_30px_rgba(167,139,250,0.1)]">
                                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-premium to-info"></div>
                                            <h3 className="text-text-secondary uppercase tracking-widest text-xs font-bold mb-2">Escrow Amount</h3>
                                            <div className="text-5xl font-mono font-bold text-white mb-1">€90<span className="text-xl text-text-dim">.00</span></div>
                                            <p className="text-text-dim text-sm">per 45-minute expert interview</p>
                                        </div>

                                        <div className="space-y-4 mb-8">
                                            <div className="flex justify-between items-center pb-4 border-b border-border-subtle">
                                                <span className="text-text-secondary">Interviewer</span>
                                                <span className="font-bold text-text-primary">Marcus Lindqvist</span>
                                            </div>
                                            <div className="flex justify-between items-center pb-4 border-b border-border-subtle">
                                                <span className="text-text-secondary">Expected Turnaround</span>
                                                <span className="font-bold text-text-primary">24 - 48 hours</span>
                                            </div>
                                            <div className="flex justify-between items-center pb-2">
                                                <span className="text-text-secondary">Payment Method</span>
                                                <span className="font-medium text-text-primary flex items-center gap-2">
                                                    <div className="bg-white px-2 py-0.5 rounded flex items-center h-5">
                                                        <span className="font-bold text-blue-800 text-[10px] tracking-tighter italic">VISA</span>
                                                    </div>
                                                    •••• 4242
                                                </span>
                                            </div>
                                        </div>

                                        <div className="bg-premium/10 border border-premium/20 rounded-xl p-4 flex gap-3 text-sm mt-auto">
                                            <Shield className="w-5 h-5 text-premium flex-shrink-0" />
                                            <p className="text-premium">Funds are held in secure escrow. You are only charged upon successful delivery of the recording and written report.</p>
                                        </div>

                                    </div>
                                )}

                            </div>

                            {/* Drawer Footer / Actions */}
                            <div className="p-6 border-t border-border-subtle bg-bg-surface flex gap-3">
                                {wizardStep > 1 && (
                                    <button
                                        onClick={() => setWizardStep(prev => prev - 1)}
                                        className="px-5 py-3 rounded-xl border border-border-subtle hover:bg-bg-elevated text-text-primary font-bold transition-colors w-1/3"
                                    >
                                        Back
                                    </button>
                                )}

                                <button
                                    onClick={() => {
                                        if (wizardStep < 3) {
                                            setWizardStep(prev => prev + 1);
                                        } else {
                                            setIsDrawerOpen(false);
                                            // Add toast logic here in real app
                                        }
                                    }}
                                    disabled={wizardStep === 1 && !selectedExpert}
                                    className={`flex-1 px-5 py-3 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${wizardStep === 1 && !selectedExpert ? 'bg-bg-elevated text-text-dim cursor-not-allowed' : 'bg-premium text-white hover:bg-premium/90 shadow-[0_4px_15px_rgba(167,139,250,0.3)]'}`}
                                >
                                    {wizardStep === 3 ? 'Confirm & Process Payment' : 'Continue'}
                                    {wizardStep < 3 && <ChevronRight className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
};

export default CandidateDossier;
