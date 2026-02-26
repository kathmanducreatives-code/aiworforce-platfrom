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

/* ── Hero format config ─────────────────────────── */
const HERO_FORMAT: Record<string, { label: string; color: string; icon: typeof BookOpen }> = {
    "Monday": { label: "Comic Strip", color: "#7c3aed", icon: BookOpen },
    "Tuesday": { label: "Data Visual", color: "#f97316", icon: BarChart2 },
    "Wednesday": { label: "Carousel", color: "#00e5a0", icon: Zap },
    "Thursday": { label: "Founder Story", color: "#3b82f6", icon: MessageSquare },
    "Friday": { label: "Short Video", color: "#ef4444", icon: Film },
    "Saturday": { label: "Hot Take", color: "#eab308", icon: Flame },
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
            title="Copy to clipboard"
            style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: "24px", height: "24px", borderRadius: "6px", flexShrink: 0,
                border: "1px solid #2a2a2a",
                background: copied ? "rgba(0,229,160,0.15)" : "#1e1e1e",
                color: copied ? "#00e5a0" : "#555",
                cursor: "pointer", transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
                if (!copied) {
                    e.currentTarget.style.borderColor = "#00e5a0";
                    e.currentTarget.style.color = "#00e5a0";
                }
            }}
            onMouseLeave={(e) => {
                if (!copied) {
                    e.currentTarget.style.borderColor = "#2a2a2a";
                    e.currentTarget.style.color = "#555";
                }
            }}
        >
            {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
    );
};

/* Field label */
const FieldLabel = ({ label }: { label: string }) => (
    <div style={{
        fontSize: "9px", fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: "#444", marginBottom: "4px",
    }}>
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
        <div style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                <FieldLabel label={label} />
                <CopyBtn text={text} id={fieldId} copiedId={copiedId} onCopy={onCopy} />
            </div>
            <div style={{
                background: "#1a1a1a", border: "1px solid #242424", borderRadius: "8px",
                padding: "9px 11px", fontSize: "12px", color: "#ccc", lineHeight: 1.6,
                whiteSpace: "pre-wrap", fontFamily: mono ? "'JetBrains Mono', 'Fira Code', monospace" : "inherit",
            }}>
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
    <div>
        <TextField
            label="LinkedIn Post Caption"
            text={day.postCaption}
            fieldId={`cap-${day.id}`}
            copiedId={copiedId}
            onCopy={onCopy}
        />
        {day.postCaption && (
            <div style={{ fontSize: "10px", color: "#444", marginBottom: "10px" }}>
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
            <>
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
            </>
        )}
        {!day.postCaption && (
            <div style={{ textAlign: "center", padding: "24px 0", color: "#333", fontSize: "12px" }}>
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
            <div style={{ textAlign: "center", padding: "24px 0", color: "#333", fontSize: "12px" }}>
                No carousel generated yet
            </div>
        );
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {slides.map((slide, si) => (
                <div key={si} style={{
                    background: "#1a1a1a", border: "1px solid #242424",
                    borderRadius: "10px", padding: "10px 12px",
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{
                            fontSize: "9px", fontWeight: 700, color: "#00e5a0",
                            background: "rgba(0,229,160,0.1)", padding: "2px 7px",
                            borderRadius: "99px", letterSpacing: "0.06em",
                        }}>
                            SLIDE {slide.slideNumber}
                        </span>
                        <CopyBtn
                            text={`Slide ${slide.slideNumber}\n${slide.headline}\n${slide.subtext}\nDesign: ${slide.designNote}`}
                            id={`slide-${day.id}-${si}`}
                            copiedId={copiedId}
                            onCopy={onCopy}
                        />
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#e0e0e0", marginBottom: "3px" }}>
                        {slide.headline}
                    </div>
                    <div style={{ fontSize: "11px", color: "#999", marginBottom: "5px", lineHeight: 1.5 }}>
                        {slide.subtext}
                    </div>
                    <div style={{ fontSize: "10px", color: "#555", fontStyle: "italic" }}>
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
            <div style={{ textAlign: "center", padding: "24px 0", color: "#333", fontSize: "12px" }}>
                No comic script generated yet
            </div>
        );
    }
    const panels = [comic.panel1, comic.panel2, comic.panel3];
    return (
        <div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                {panels.map((panel, pi) => (
                    <div key={pi} style={{
                        background: "#1a1a1a", border: "1px solid #2a2020",
                        borderRadius: "10px", padding: "10px 12px",
                        borderLeft: "3px solid #7c3aed",
                    }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                            <span style={{
                                fontSize: "9px", fontWeight: 700, color: "#7c3aed",
                                background: "rgba(124,58,237,0.12)", padding: "2px 7px",
                                borderRadius: "99px", letterSpacing: "0.06em",
                            }}>
                                PANEL {pi + 1}
                            </span>
                            <CopyBtn
                                text={`Panel ${pi + 1}\nScene: ${panel.scene}\nDialogue: ${panel.dialogue}${panel.expression ? `\nExpression: ${panel.expression}` : ''}`}
                                id={`panel-${day.id}-${pi}`}
                                copiedId={copiedId}
                                onCopy={onCopy}
                            />
                        </div>
                        <div style={{ fontSize: "11px", color: "#999", marginBottom: "5px" }}>
                            <span style={{ color: "#555", fontWeight: 600 }}>Scene: </span>{panel.scene}
                        </div>
                        <div style={{ fontSize: "12px", color: "#e0e0e0", fontWeight: 500 }}>
                            <span style={{ color: "#555", fontWeight: 600 }}>Dialogue: </span>{panel.dialogue}
                        </div>
                        {panel.expression && (
                            <div style={{ fontSize: "10px", color: "#555", marginTop: "4px", fontStyle: "italic" }}>
                                {panel.expression}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Comic Image Prompt + Generate button */}
            <div style={{
                background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)",
                borderRadius: "10px", padding: "10px 12px", marginBottom: "10px",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <FieldLabel label="DALL-E Comic Prompt" />
                    <CopyBtn
                        text={comic.comicImagePrompt}
                        id={`comic-prompt-${day.id}`}
                        copiedId={copiedId}
                        onCopy={onCopy}
                    />
                </div>
                <div style={{ fontSize: "11px", color: "#b39ddb", lineHeight: 1.55, marginBottom: "10px" }}>
                    {comic.comicImagePrompt}
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(comic.comicImagePrompt).then(() => {
                            onCopy(comic.comicImagePrompt, `comic-prompt-${day.id}`);
                        });
                    }}
                    style={{
                        display: "inline-flex", alignItems: "center", gap: "7px",
                        background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                        color: "#fff", border: "none", borderRadius: "8px",
                        padding: "8px 14px", fontSize: "12px", fontWeight: 600,
                        cursor: "pointer", boxShadow: "0 3px 10px rgba(124,58,237,0.3)",
                        transition: "all 0.2s ease", fontFamily: "'Inter', sans-serif",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = "0 5px 16px rgba(124,58,237,0.45)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = "0 3px 10px rgba(124,58,237,0.3)";
                        e.currentTarget.style.transform = "translateY(0)";
                    }}
                >
                    <ClipboardCopy size={13} />
                    Generate Comic Prompt
                </button>
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
            <div style={{ textAlign: "center", padding: "24px 0", color: "#333", fontSize: "12px" }}>
                No data visual generated yet
            </div>
        );
    }
    return (
        <div>
            {/* Big stat number hero display */}
            <div style={{
                background: "#1a1a1a", border: "1px solid #2a1a0a",
                borderRadius: "12px", padding: "16px",
                textAlign: "center", marginBottom: "10px",
                borderLeft: "3px solid #f97316",
            }}>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
                    <CopyBtn
                        text={`${dv.statNumber}\n${dv.statContext}`}
                        id={`dv-stat-${day.id}`}
                        copiedId={copiedId}
                        onCopy={onCopy}
                    />
                </div>
                <div style={{ fontSize: "36px", fontWeight: 900, color: "#f97316", lineHeight: 1, marginBottom: "6px" }}>
                    {dv.statNumber}
                </div>
                <div style={{ fontSize: "12px", color: "#999", lineHeight: 1.5 }}>
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
            <div style={{ textAlign: "center", padding: "24px 0", color: "#333", fontSize: "12px" }}>
                No hot take generated yet
            </div>
        );
    }
    return (
        <div>
            <div style={{
                background: "#1a1a10", border: "1px solid #2a2a10",
                borderRadius: "12px", padding: "14px", marginBottom: "10px",
                borderLeft: "3px solid #eab308",
            }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "4px" }}>
                    <FieldLabel label="Unpopular Opinion" />
                    <CopyBtn text={ht.headline} id={`ht-head-${day.id}`} copiedId={copiedId} onCopy={onCopy} />
                </div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#eab308", lineHeight: 1.4 }}>
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
            <div style={{ textAlign: "center", padding: "24px 0", color: "#333", fontSize: "12px" }}>
                No poll generated yet
            </div>
        );
    }
    const options = [poll.option1, poll.option2, poll.option3, poll.option4];
    return (
        <div>
            <div style={{
                background: "#1a1a1a", border: "1px solid #242424",
                borderRadius: "12px", padding: "14px", marginBottom: "10px",
            }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
                    <FieldLabel label="Poll Question" />
                    <CopyBtn
                        text={`${poll.question}\n1. ${poll.option1}\n2. ${poll.option2}\n3. ${poll.option3}\n4. ${poll.option4}`}
                        id={`poll-q-${day.id}`}
                        copiedId={copiedId}
                        onCopy={onCopy}
                    />
                </div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#e0e0e0", marginBottom: "10px" }}>
                    {poll.question}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {options.map((opt, oi) => (
                        <div key={oi} style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            background: "#222", borderRadius: "7px", padding: "7px 10px",
                            border: "1px solid #2a2a2a",
                        }}>
                            <span style={{
                                width: "18px", height: "18px", borderRadius: "50%",
                                background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.3)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: "9px", fontWeight: 700, color: "#00e5a0", flexShrink: 0,
                            }}>{oi + 1}</span>
                            <span style={{ fontSize: "12px", color: "#ccc", flex: 1 }}>{opt}</span>
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
        { label: "Caption ready", done: !!day.postCaption },
        { label: "Media uploaded", done: !!day.mediaBase64 },
        { label: "Carousel built", done: day.carouselScript && day.carouselScript.length > 0 },
        { label: "Comic generated", done: !!day.comicScript },
        { label: "Scheduled", done: day.status === "Posted" },
    ];
    return (
        <div style={{
            borderTop: "1px solid #1e1e1e", paddingTop: "10px", marginTop: "4px",
            display: "flex", flexWrap: "wrap", gap: "6px",
        }}>
            {items.map((item, i) => (
                <div key={i} style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    fontSize: "10px", fontWeight: 500,
                    color: item.done ? "#00e5a0" : "#3a3a3a",
                    background: item.done ? "rgba(0,229,160,0.08)" : "#1a1a1a",
                    border: `1px solid ${item.done ? "rgba(0,229,160,0.2)" : "#242424"}`,
                    borderRadius: "6px", padding: "3px 8px",
                    transition: "all 0.2s ease",
                }}>
                    <span style={{ fontSize: "11px" }}>{item.done ? "✓" : "○"}</span>
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

    const statusDot = isScheduled ? "#00e5a0" : day.postCaption ? "#f59e0b" : "#3a3a3a";

    return (
        <div style={{
            borderRadius: "18px",
            border: `1px solid ${isScheduled ? "rgba(0,229,160,0.25)" : "#1e1e1e"}`,
            background: "#141414",
            boxShadow: isScheduled ? "0 0 20px rgba(0,229,160,0.06)" : "none",
            transition: "all 0.25s ease",
            overflow: "hidden",
        }}>

            {/* ── Card Header ── */}
            <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "12px 14px 10px",
                borderBottom: "1px solid #1e1e1e",
            }}>
                {/* Day badge */}
                <div style={{
                    width: "32px", height: "32px", borderRadius: "9px", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: isScheduled ? "rgba(0,229,160,0.12)" : "#1e1e1e",
                    fontSize: "9px", fontWeight: 800, color: isScheduled ? "#00e5a0" : "#555",
                    textTransform: "uppercase", letterSpacing: "0.03em",
                }}>
                    {dayShort}
                </div>

                {/* Day name + status text */}
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#e0e0e0", lineHeight: 1.2 }}>
                        {day.day}
                    </div>
                    <div style={{ fontSize: "10px", fontWeight: 600, color: statusDot, marginTop: "1px" }}>
                        {isScheduled ? "Scheduled" : day.postCaption ? "Draft Ready" : "Empty"}
                    </div>
                </div>

                {/* Hero format badge */}
                {hero && (
                    <div style={{
                        display: "inline-flex", alignItems: "center", gap: "4px",
                        background: `${hero.color}14`, border: `1px solid ${hero.color}30`,
                        borderRadius: "8px", padding: "3px 8px",
                        fontSize: "9px", fontWeight: 700, color: hero.color,
                        letterSpacing: "0.04em", textTransform: "uppercase",
                    }}>
                        <HeroIcon size={9} />
                        {hero.label}
                    </div>
                )}

                {/* Status dot */}
                <div style={{
                    width: "8px", height: "8px", borderRadius: "50%",
                    background: statusDot,
                    boxShadow: day.postCaption || isScheduled ? `0 0 6px ${statusDot}88` : "none",
                    flexShrink: 0,
                }} />
            </div>

            {/* ── Date + Time Picker Row ── */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 14px",
                borderBottom: "1px solid #1a1a1a",
                background: "#111",
            }}>
                {onDateChange && (
                    <input
                        type="date"
                        value={day.scheduledDate || ""}
                        onChange={(e) => onDateChange(index, e.target.value)}
                        style={{
                            background: "#1a1a1a", border: "1px solid #2a2a2a",
                            borderRadius: "8px", padding: "4px 8px",
                            color: day.scheduledDate ? "#00e5a0" : "#555",
                            fontSize: "11px", fontWeight: 600,
                            outline: "none", cursor: "pointer",
                            fontFamily: "'Inter', sans-serif",
                        }}
                    />
                )}
                <TimePicker
                    value={day.scheduledTime || "08:00"}
                    onChange={(val) => onTimeChange(index, val)}
                />
            </div>

            {/* ── Tab Row ── */}
            <div style={{
                display: "flex", gap: "4px", padding: "8px 10px 0",
                overflowX: "auto", scrollbarWidth: "none",
            }}>
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                padding: "4px 10px", borderRadius: "99px", border: "none",
                                background: isActive ? "#00e5a0" : "#1e1e1e",
                                color: isActive ? "#000" : "#555",
                                fontSize: "10px", fontWeight: isActive ? 700 : 500,
                                cursor: "pointer", whiteSpace: "nowrap",
                                transition: "all 0.15s ease", flexShrink: 0,
                                letterSpacing: isActive ? "0.02em" : "0",
                            }}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* ── Tab Content ── */}
            <div style={{
                padding: "12px 14px",
                maxHeight: "380px",
                overflowY: "auto",
                scrollbarWidth: "thin",
            }}>
                {activeTab === "caption" && <CaptionTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "carousel" && <CarouselTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "comic" && <ComicTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "datavisual" && <DataVisualTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "hottake" && <HotTakeTab day={day} copiedId={copiedId} onCopy={onCopy} />}
                {activeTab === "poll" && <PollTab day={day} copiedId={copiedId} onCopy={onCopy} />}
            </div>

            {/* ── Media Upload ── */}
            <div style={{ padding: "0 14px 10px", borderTop: "1px solid #1a1a1a" }}>
                <div style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#333", padding: "8px 0 6px" }}>
                    <ImageIcon size={9} style={{ display: "inline", marginRight: "4px" }} />
                    Visual Asset
                </div>
                <MediaUpload
                    fileBase64={day.mediaBase64 || null}
                    fileName={day.mediaName || null}
                    fileType={day.mediaType || null}
                    onUpload={(base64, name, type) => onFileChange(index, base64, name, type)}
                    onRemove={() => onRemoveFile(index)}
                />
            </div>

            {/* ── Content Checklist ── */}
            <div style={{ padding: "0 14px 10px" }}>
                <ContentChecklist day={day} />
            </div>

            {/* ── Manual Override (collapsible) ── */}
            <div style={{ borderTop: "1px solid #1a1a1a" }}>
                <button
                    onClick={() => setShowManual(s => !s)}
                    style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "7px 14px", background: "transparent", border: "none",
                        cursor: "pointer", color: "#333", fontSize: "10px", fontWeight: 500,
                    }}
                >
                    Manual Override
                    {showManual ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showManual && (
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "0 14px 12px",
                    }}>
                        <span style={{ fontSize: "11px", color: "#444" }}>
                            Mark as {isScheduled ? "Draft" : "Scheduled"}
                        </span>
                        <ToggleSwitch checked={isScheduled} onChange={() => onStatusToggle(index)} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default DayCard;
