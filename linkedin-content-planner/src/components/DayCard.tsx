import { useState } from "react";
import {
    Check, Copy, BookOpen, BarChart2, Film, Zap, MessageSquare, Flame,
    Image as ImageIcon, ClipboardCopy, ChevronDown, ChevronUp
} from "lucide-react";
import MediaUpload from "./MediaUpload";
import TimePicker from "./TimePicker";
import ToggleSwitch from "../ToggleSwitch";
import type {
    DayPlan, CarouselSlide, ComicScript, DataVisual, HotTake, Poll, VideoIdea
} from "../types";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

/* ── Hero format config ─────────────────────────── */
const HERO_FORMAT: Record<string, { label: string; variant: any; icon: typeof BookOpen }> = {
    "Monday": { label: "Comic Strip", variant: "violet", icon: BookOpen },
    "Tuesday": { label: "Data Visual", variant: "amber", icon: BarChart2 },
    "Wednesday": { label: "Carousel", variant: "emerald", icon: Zap },
    "Thursday": { label: "Founder Story", variant: "blue", icon: MessageSquare },
    "Friday": { label: "Short Video", variant: "red", icon: Film },
    "Saturday": { label: "Hot Take", variant: "amber", icon: Flame },
};

type TabId = "caption" | "carousel" | "comic" | "datavisual" | "hottake" | "poll";

const TABS: { id: TabId; label: string }[] = [
    { id: "caption", label: "Caption" },
    { id: "carousel", label: "Carousel" },
    { id: "comic", label: "Comic" },
    { id: "datavisual", label: "Data Visual" },
    { id: "hottake", label: "Hot Take" },
    { id: "poll", label: "Poll" },
];

/* ── Props ──────────────────────────────────────── */
interface DayCardProps {
    day: DayPlan;
    dayShort: string;
    index: number;
    copiedId: string | null;
    onStatusToggle: (index: number) => void;
    onCopy: (text: string, id: string) => void;
    onFileChange: (index: number, base64: string, name: string, type: "image" | "video") => void;
    onRemoveFile: (index: number) => void;
    onTimeChange: (index: number, time: string) => void;
    onDateChange?: (index: number, date: string) => void;
}

/* ════════════════════════════════════════════════
   SHARED MICRO-COMPONENTS
   ════════════════════════════════════════════════ */

/* Copy button */
const CopyBtn = ({
    text, id, copiedId, onCopy
}: { text: string; id: string; copiedId: string | null; onCopy: (t: string, i: string) => void }) => {
    const copied = copiedId === id;
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onCopy(text, id); }}
            className={`
                flex items-center justify-center w-6 h-6 rounded-md shrink-0 border transition-all duration-200 cursor-pointer
                ${copied
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                    : "bg-white/[0.04] border-white/[0.08] text-slate-500 hover:text-emerald-400 hover:border-emerald-500/50"}
            `}
            title="Copy to clipboard"
        >
            {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
    );
};

/* Field label */
const FieldLabel = ({ label }: { label: string }) => (
    <div className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1.5">
        {label}
    </div>
);

/* Text field box with copy button */
const TextField = ({
    label, text, fieldId, copiedId, onCopy, mono = false,
}: {
    label: string; text: string; fieldId: string;
    copiedId: string | null; onCopy: (t: string, i: string) => void; mono?: boolean;
}) => {
    if (!text) return null;
    return (
        <div className="mb-4">
            <div className="flex items-center justify-between gap-2 mb-1">
                <FieldLabel label={label} />
                <CopyBtn text={text} id={fieldId} copiedId={copiedId} onCopy={onCopy} />
            </div>
            <div className={`
                bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-[12px] text-slate-300 leading-relaxed whitespace-pre-wrap
                ${mono ? "font-mono" : "font-sans"}
            `}>
                {text}
            </div>
        </div>
    );
};

/* ════════════════════════════════════════════════
   TAB CONTENT COMPONENTS
   ════════════════════════════════════════════════ */

/* Caption Tab */
const CaptionTab = ({
    day, copiedId, onCopy
}: { day: DayPlan; copiedId: string | null; onCopy: (t: string, i: string) => void }) => (
    <div className="animate-fade-in">
        <TextField
            label="LinkedIn Post Caption"
            text={day.postCaption}
            fieldId={`cap-${day.id}`}
            copiedId={copiedId}
            onCopy={onCopy}
        />
        {day.postCaption && (
            <div className="text-[10px] text-slate-600 font-medium mb-4 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-slate-700" />
                {day.postCaption.split(/\s+/).filter(Boolean).length} words
            </div>
        )}
        <TextField
            label="Image Prompt (DALL-E)"
            text={day.imagePrompt}
            fieldId={`img-${day.id}`}
            copiedId={copiedId}
            onCopy={onCopy}
        />
        {day.videoIdea && (
            <div className="space-y-4">
                <TextField
                    label="Video Concept"
                    text={(day.videoIdea as VideoIdea).concept}
                    fieldId={`vid-concept-${day.id}`}
                    copiedId={copiedId}
                    onCopy={onCopy}
                />
                <TextField
                    label="Hook Line (First 3 Seconds)"
                    text={(day.videoIdea as VideoIdea).hookLine}
                    fieldId={`vid-hook-${day.id}`}
                    copiedId={copiedId}
                    onCopy={onCopy}
                />
                <TextField
                    label="Script Outline"
                    text={(day.videoIdea as VideoIdea).scriptOutline}
                    fieldId={`vid-script-${day.id}`}
                    copiedId={copiedId}
                    onCopy={onCopy}
                />
                <TextField
                    label="Closing CTA"
                    text={(day.videoIdea as VideoIdea).closingCTA}
                    fieldId={`vid-cta-${day.id}`}
                    copiedId={copiedId}
                    onCopy={onCopy}
                />
            </div>
        )}
        {!day.postCaption && (
            <div className="text-center py-8 text-slate-600 text-xs italic">
                No caption yet — click Generate Content Plan
            </div>
        )}
    </div>
);

/* Carousel Tab */
const CarouselTab = ({
    day, copiedId, onCopy
}: { day: DayPlan; copiedId: string | null; onCopy: (t: string, i: string) => void }) => {
    const slides: CarouselSlide[] = day.carouselScript || [];
    if (slides.length === 0) {
        return (
            <div className="text-center py-8 text-slate-600 text-xs italic">
                No carousel generated yet
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-3 animate-fade-in">
            {slides.map((slide, si) => (
                <div key={si} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 group hover:border-emerald-500/20 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                        <Badge variant="emerald" className="bg-emerald-500/10 text-[9px] px-2 py-0.5 font-black uppercase">
                            SLIDE {slide.slideNumber}
                        </Badge>
                        <CopyBtn
                            text={`Slide ${slide.slideNumber}\n${slide.headline}\n${slide.subtext}\nDesign: ${slide.designNote}`}
                            id={`slide-${day.id}-${si}`}
                            copiedId={copiedId}
                            onCopy={onCopy}
                        />
                    </div>
                    <div className="text-[13px] font-black text-white mb-1.5 leading-snug">
                        {slide.headline}
                    </div>
                    <div className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                        {slide.subtext}
                    </div>
                    <div className="text-[10px] text-slate-600 italic font-medium px-2 py-1.5 bg-black/20 rounded-lg">
                        Design: {slide.designNote}
                    </div>
                </div>
            ))}
        </div>
    );
};

/* Comic Tab */
const ComicTab = ({
    day, copiedId, onCopy
}: { day: DayPlan; copiedId: string | null; onCopy: (t: string, i: string) => void }) => {
    const comic: ComicScript | null = day.comicScript;
    if (!comic) {
        return (
            <div className="text-center py-8 text-slate-600 text-xs italic">
                No comic script generated yet
            </div>
        );
    }
    const panels = [comic.panel1, comic.panel2, comic.panel3];
    return (
        <div className="animate-fade-in">
            <div className="flex flex-col gap-3 mb-6">
                {panels.map((panel, pi) => (
                    <div key={pi} className="bg-white/[0.04] border-l-4 border-l-violet-500 border-r border-t border-b border-white/[0.08] rounded-xl p-4 group hover:bg-white/[0.06] transition-colors">
                        <div className="flex items-center justify-between mb-2.5">
                            <Badge variant="violet" className="text-[9px] font-black uppercase">
                                PANEL {pi + 1}
                            </Badge>
                            <CopyBtn
                                text={`Panel ${pi + 1}\nScene: ${panel.scene}\nDialogue: ${panel.dialogue}${panel.expression ? `\nExpression: ${panel.expression}` : ''}`}
                                id={`panel-${day.id}-${pi}`}
                                copiedId={copiedId}
                                onCopy={onCopy}
                            />
                        </div>
                        <div className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                            <span className="text-slate-600 font-black uppercase text-[9px] mr-1">Scene:</span>{panel.scene}
                        </div>
                        <div className="text-[12px] text-slate-200 font-semibold leading-relaxed">
                            <span className="text-slate-600 font-black uppercase text-[9px] mr-1">Dialogue:</span>"{panel.dialogue}"
                        </div>
                        {panel.expression && (
                            <div className="text-[10px] text-slate-600 mt-2.5 border-t border-white/[0.04] pt-2 italic">
                                {panel.expression}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Comic Image Prompt + Generate button */}
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-5 mb-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-violet-600/10 blur-3xl rounded-full translate-x-12 -translate-y-12" />

                <div className="flex items-center justify-between mb-3">
                    <FieldLabel label="DALL-E Comic Prompt" />
                    <CopyBtn
                        text={comic.comicImagePrompt}
                        id={`comic-prompt-${day.id}`}
                        copiedId={copiedId}
                        onCopy={onCopy}
                    />
                </div>
                <div className="text-[11px] text-violet-300/80 leading-relaxed mb-5 font-medium">
                    {comic.comicImagePrompt}
                </div>
                <Button
                    variant="primary"
                    size="sm"
                    className="!bg-violet-600 !hover:bg-violet-500 !shadow-none w-full"
                    onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(comic.comicImagePrompt).then(() => {
                            onCopy(comic.comicImagePrompt, `comic-prompt-${day.id}`);
                        });
                    }}
                >
                    <ClipboardCopy size={13} className="mr-2" />
                    Copy Visual Prompt
                </Button>
            </div>
        </div>
    );
};

/* Data Visual Tab */
const DataVisualTab = ({
    day, copiedId, onCopy
}: { day: DayPlan; copiedId: string | null; onCopy: (t: string, i: string) => void }) => {
    const dv: DataVisual | null = day.dataVisual;
    if (!dv) {
        return (
            <div className="text-center py-8 text-slate-600 text-xs italic">
                No data visual generated yet
            </div>
        );
    }
    return (
        <div className="animate-fade-in">
            {/* Big stat number hero display */}
            <div className="bg-white/[0.04] border-l-4 border-l-amber-500 border-r border-t border-b border-white/[0.08] rounded-2xl p-6 text-center mb-4 group hover:bg-white/[0.06] transition-colors">
                <div className="flex justify-end mb-2">
                    <CopyBtn
                        text={`${dv.statNumber}\n${dv.statContext}`}
                        id={`dv-stat-${day.id}`}
                        copiedId={copiedId}
                        onCopy={onCopy}
                    />
                </div>
                <div className="text-4xl font-black text-amber-500 mb-2 drop-shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                    {dv.statNumber}
                </div>
                <div className="text-[12px] text-slate-400 font-medium leading-relaxed max-w-[200px] mx-auto">
                    {dv.statContext}
                </div>
            </div>
            <TextField
                label="Visual Prompt (DALL-E)"
                text={dv.visualPrompt}
                fieldId={`dv-prompt-${day.id}`}
                copiedId={copiedId}
                onCopy={onCopy}
            />
            <TextField
                label="Post Caption"
                text={dv.caption}
                fieldId={`dv-caption-${day.id}`}
                copiedId={copiedId}
                onCopy={onCopy}
            />
        </div>
    );
};

/* Hot Take Tab */
const HotTakeTab = ({
    day, copiedId, onCopy
}: { day: DayPlan; copiedId: string | null; onCopy: (t: string, i: string) => void }) => {
    const ht: HotTake | null = day.hotTake;
    if (!ht) {
        return (
            <div className="text-center py-8 text-slate-600 text-xs italic">
                No hot take generated yet
            </div>
        );
    }
    return (
        <div className="animate-fade-in">
            <div className="bg-white/[0.04] border-l-4 border-l-amber-500 border-r border-t border-b border-white/[0.08] rounded-2xl p-5 mb-4">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                    <FieldLabel label="Unpopular Opinion" />
                    <CopyBtn text={ht.headline} id={`ht-head-${day.id}`} copiedId={copiedId} onCopy={onCopy} />
                </div>
                <div className="text-[15px] font-black text-amber-400 leading-tight">
                    "{ht.headline}"
                </div>
            </div>
            <TextField
                label="Argument"
                text={ht.bodyText}
                fieldId={`ht-body-${day.id}`}
                copiedId={copiedId}
                onCopy={onCopy}
            />
            <TextField
                label="Closing CTA"
                text={ht.closingCTA}
                fieldId={`ht-cta-${day.id}`}
                copiedId={copiedId}
                onCopy={onCopy}
            />
        </div>
    );
};

/* Poll Tab */
const PollTab = ({
    day, copiedId, onCopy
}: { day: DayPlan; copiedId: string | null; onCopy: (t: string, i: string) => void }) => {
    const poll: Poll | null = day.poll;
    if (!poll) {
        return (
            <div className="text-center py-8 text-slate-600 text-xs italic">
                No poll generated yet
            </div>
        );
    }
    const options = [poll.option1, poll.option2, poll.option3, poll.option4].filter(Boolean);
    return (
        <div className="animate-fade-in">
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-4 hover:border-white/[0.12] transition-colors">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex flex-col gap-1">
                        <FieldLabel label="Poll Question" />
                        <div className="text-[13px] font-bold text-white leading-snug">
                            {poll.question}
                        </div>
                    </div>
                    <CopyBtn
                        text={`${poll.question}\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`}
                        id={`poll-q-${day.id}`}
                        copiedId={copiedId}
                        onCopy={onCopy}
                    />
                </div>
                <div className="flex flex-col gap-2">
                    {options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 hover:bg-white/[0.06] transition-colors group">
                            <span className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[10px] font-black text-emerald-400 shrink-0 group-hover:scale-110 transition-transform">
                                {oi + 1}
                            </span>
                            <span className="text-[12px] text-slate-300 font-medium">{opt}</span>
                        </div>
                    ))}
                </div>
            </div>
            <TextField
                label="Follow-Up Comment (Post after publishing)"
                text={poll.followUpComment}
                fieldId={`poll-follow-${day.id}`}
                copiedId={copiedId}
                onCopy={onCopy}
            />
        </div>
    );
};

/* ════════════════════════════════════════════════
   CONTENT CHECKLIST
   ════════════════════════════════════════════════ */
const ContentChecklist = ({ day }: { day: DayPlan }) => {
    const items = [
        { label: "Caption", done: !!day.postCaption },
        { label: "Media", done: !!day.mediaBase64 },
        { label: "Carousel", done: day.carouselScript && day.carouselScript.length > 0 },
        { label: "Comic", done: !!day.comicScript },
        { label: "Posted", done: day.status === "Posted" },
    ];
    return (
        <div className="flex flex-wrap gap-2 pt-3 border-t border-white/[0.04]">
            {items.map((item, i) => (
                <div key={i} className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-300
                    ${item.done
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-white/[0.02] text-slate-700 border border-transparent opacity-50"}
                `}>
                    <div className={`w-1 h-1 rounded-full ${item.done ? "bg-emerald-400 animate-pulse" : "bg-slate-800"}`} />
                    {item.label}
                </div>
            ))}
        </div>
    );
};

/* ════════════════════════════════════════════════
   MAIN DAY CARD
   ════════════════════════════════════════════════ */
const DayCard = ({
    day, dayShort, index, copiedId,
    onStatusToggle, onCopy,
    onFileChange, onRemoveFile, onTimeChange, onDateChange
}: DayCardProps) => {
    const [activeTab, setActiveTab] = useState<TabId>("caption");
    const [showManual, setShowManual] = useState(false);

    const hero = HERO_FORMAT[day.day];
    const HeroIcon = hero?.icon;
    const isScheduled = day.status === "Posted";

    const statusColorClass = isScheduled ? "text-emerald-400" : day.postCaption ? "text-amber-400" : "text-slate-600";
    const statusDotClass = isScheduled ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : day.postCaption ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-slate-800";

    return (
        <Card className={`
            !p-0 overflow-hidden flex flex-col h-full group/card transition-all duration-300
            ${isScheduled ? "border-emerald-500/30 bg-emerald-500/[0.02]" : "hover:border-white/[0.15]"}
            shadow-xl
        `}>
            {/* ── Card Header ── */}
            <div className="flex items-center gap-3 p-4 border-b border-white/[0.08] bg-white/[0.01]">
                {/* Day badge */}
                <div className={`
                    w-10 h-10 rounded-xl flex items-center justify-center font-black text-[12px] uppercase shrink-0 transition-transform group-hover/card:scale-105
                    ${isScheduled ? "bg-emerald-500/20 text-emerald-400" : "bg-white/[0.05] text-slate-500"}
                `}>
                    {dayShort.split(' ')[1]}
                </div>

                {/* Day name + status text */}
                <div className="flex-1">
                    <div className="text-[15px] font-black text-white leading-none mb-1">
                        {day.day}
                    </div>
                    <div className={`text-[10px] font-black uppercase tracking-wider ${statusColorClass} flex items-center gap-2`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
                        {isScheduled ? "Scheduled" : day.postCaption ? "Draft Ready" : "Drafting..."}
                    </div>
                </div>

                {/* Hero format badge */}
                {hero && (
                    <Badge variant={hero.variant} className="px-2.5 py-1 rounded-lg">
                        <HeroIcon size={12} className="mr-1.5" />
                        {hero.label}
                    </Badge>
                )}
            </div>

            {/* ── Date + Time Picker Row ── */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04] bg-black/20">
                {onDateChange && (
                    <div className="relative group">
                        <input
                            type="date"
                            value={day.scheduledDate || ""}
                            onChange={(e) => onDateChange(index, e.target.value)}
                            className={`
                                bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-[11px] font-black outline-none cursor-pointer transition-all hover:bg-white/10
                                ${day.scheduledDate ? "text-emerald-400 border-emerald-500/30" : "text-slate-500"}
                            `}
                        />
                    </div>
                )}
                <div className="scale-90 origin-right">
                    <TimePicker
                        value={day.scheduledTime || "08:00"}
                        onChange={(val) => onTimeChange(index, val)}
                    />
                </div>
            </div>

            {/* ── Tab Row ── */}
            <div className="flex gap-1.5 p-3 overflow-x-auto scrollbar-none scroll-smooth">
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                                px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 whitespace-nowrap cursor-pointer shrink-0
                                ${isActive
                                    ? "bg-white text-black shadow-lg shadow-white/10"
                                    : "bg-white/[0.04] text-slate-500 hover:bg-white/[0.08] hover:text-slate-300"}
                            `}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* ── Tab Content ── */}
            <div className="flex-1 px-4 pb-4 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                {activeTab === "caption" && <CaptionTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "carousel" && <CarouselTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "comic" && <ComicTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "datavisual" && <DataVisualTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "hottake" && <HotTakeTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "poll" && <PollTab day={day} copiedId={copiedId} onCopy={onCopy} />}
            </div>

            {/* ── Bottom Section ── */}
            <div className="p-4 pt-0 mt-auto space-y-4">
                {/* Media Upload */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-600">
                        <ImageIcon size={11} className="text-slate-500" />
                        Visual Asset
                    </div>
                    <div className="bg-black/20 rounded-2xl p-1 border border-white/[0.04]">
                        <MediaUpload
                            fileBase64={day.mediaBase64 || null}
                            fileName={day.mediaName || null}
                            fileType={day.mediaType || null}
                            onUpload={(base64, name, type) => onFileChange(index, base64, name, type)}
                            onRemove={() => onRemoveFile(index)}
                        />
                    </div>
                </div>

                {/* Content Checklist */}
                <ContentChecklist day={day} />

                {/* Manual Override (collapsible) */}
                <div className="border-t border-white/[0.04] pt-1">
                    <button
                        onClick={() => setShowManual(s => !s)}
                        className="w-full flex items-center justify-between py-2 text-slate-700 hover:text-slate-500 transition-colors cursor-pointer text-[9px] font-black uppercase tracking-widest"
                    >
                        <span>Manual Status Override</span>
                        {showManual ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {showManual && (
                        <div className="flex items-center justify-between pb-2 animate-slide-down">
                            <span className="text-[11px] text-slate-500 font-medium italic">
                                Force status to {isScheduled ? "Draft" : "Scheduled"}
                            </span>
                            <div className="scale-75 origin-right">
                                <ToggleSwitch checked={isScheduled} onChange={() => onStatusToggle(index)} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
};

export default DayCard;
