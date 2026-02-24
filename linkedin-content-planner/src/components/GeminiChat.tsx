import { useState, useRef, useEffect } from "react";
import { GoogleGenAI } from "@google/genai";
import { Sparkles, Send, Loader2, Bot, User, Trash2, Image as ImageIcon, Film } from "lucide-react";
import { toast } from "sonner";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
}

export default function GeminiChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || "");
    const [showKeyInput, setShowKeyInput] = useState(!import.meta.env.VITE_GEMINI_API_KEY);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim()) return;
        if (!apiKey) {
            toast.error("Please enter a Gemini API Key");
            setShowKeyInput(true);
            return;
        }

        const userMessage: Message = { id: Date.now().toString(), role: "user", content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput("");
        setIsLoading(true);

        try {
            const ai = new GoogleGenAI({ apiKey });
            const isImageRequest = input.toLowerCase().includes("generate an image") || input.toLowerCase().includes("create an image") || input.toLowerCase().includes("draw");

            if (isImageRequest) {
                try {
                    // Call Imagen model for image generation
                    const response = await ai.models.generateImages({
                        model: 'imagen-3.0-generate-001',
                        prompt: input,
                        config: {
                            numberOfImages: 1,
                            outputMimeType: 'image/jpeg',
                            aspectRatio: '1:1'
                        }
                    });

                    const base64Image = response.generatedImages?.[0]?.image?.imageBytes;

                    if (base64Image) {
                        const assistantMessage: Message = {
                            id: (Date.now() + 1).toString(),
                            role: "assistant",
                            content: `Here is the generated image:\n![Generated Image](data:image/jpeg;base64,${base64Image})`
                        };
                        setMessages(prev => [...prev, assistantMessage]);
                    } else {
                        throw new Error("No image data returned from API.");
                    }
                } catch (imgError: any) {
                    console.error("Imagen API Error:", imgError);
                    let errMsg = "I'm sorry, I couldn't generate the image.";
                    if (imgError.message?.includes("billed users at this time")) {
                        errMsg = "The Imagen API requires a paid Google Cloud billing account. Your current API key is on the free tier, which only supports text generation. However, I can still write image prompts for you to use in tools like Midjourney or DALL-E!";
                    } else {
                        errMsg += ` Error details: ${imgError.message}`;
                    }
                    const assistantMessage: Message = {
                        id: (Date.now() + 1).toString(),
                        role: "assistant",
                        content: errMsg
                    };
                    setMessages(prev => [...prev, assistantMessage]);
                }

            } else {
                // Standard Text generation
                let promptContext = "You are a creative LinkedIn content strategist helping generate ideas for text, carousels, generated images, and video scripts. Be concise, highly professional, and focus on viral organic growth.\n\n";
                promptContext += messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join("\n");
                promptContext += `\nUser: ${userMessage.content}\nAssistant:`;

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: promptContext,
                });

                const assistantMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: response.text || "I couldn't generate a response."
                };
                setMessages(prev => [...prev, assistantMessage]);
            }

        } catch (error) {
            console.error("Gemini API Error:", error);
            toast.error("Failed to get response from Gemini.");
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "Error: Could not connect to Gemini API. Please check your API key."
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            display: "flex", flexDirection: "column", height: "100%", width: "100%",
            background: "#141414", borderRadius: "16px", border: "1px solid #2a2a2a",
            overflow: "hidden"
        }}>
            {/* Header */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "16px", borderBottom: "1px solid #2a2a2a", background: "#1a1a1a"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{
                        background: "linear-gradient(135deg, #a855f7, #6366f1)",
                        width: "32px", height: "32px", borderRadius: "8px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 2px 10px rgba(168, 85, 247, 0.2)"
                    }}>
                        <Sparkles size={16} color="#fff" />
                    </div>
                    <div>
                        <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#fff", margin: 0 }}>Gemini Assistant</h2>
                        <span style={{ fontSize: "11px", color: "#888" }}>LinkedIn Creative Co-pilot</span>
                    </div>
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                    <button
                        onClick={() => setShowKeyInput(!showKeyInput)}
                        style={{
                            background: "transparent", border: "1px solid #333", borderRadius: "6px",
                            padding: "6px 10px", fontSize: "11px", color: "#ccc", cursor: "pointer",
                            transition: "all 0.2s"
                        }}
                    >
                        API Key
                    </button>
                    <button
                        onClick={() => setMessages([])}
                        title="Clear Chat"
                        style={{
                            background: "transparent", border: "1px solid #333", borderRadius: "6px",
                            padding: "6px", color: "#ef4444", cursor: "pointer", transition: "all 0.2s"
                        }}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {/* API Key Input (Toggleable) */}
            {showKeyInput && (
                <div style={{ padding: "12px 16px", background: "#111", borderBottom: "1px solid #2a2a2a" }}>
                    <div style={{ fontSize: "11px", color: "#888", marginBottom: "6px" }}>Gemini API Key:</div>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        style={{
                            width: "100%", background: "#000", border: "1px solid #333", color: "#fff",
                            padding: "8px 12px", borderRadius: "6px", fontSize: "12px", outline: "none"
                        }}
                    />
                </div>
            )}

            {/* Chat Messages */}
            <div style={{
                flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "16px"
            }}>
                {messages.length === 0 ? (
                    <div style={{
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        height: "100%", color: "#555", textAlign: "center", gap: "12px"
                    }}>
                        <Bot size={48} color="#333" />
                        <div>
                            <p style={{ fontSize: "14px", fontWeight: 600, color: "#888", margin: "0 0 6px" }}>How can I help you create today?</p>
                            <p style={{ fontSize: "12px", maxWidth: "250px", margin: 0, lineHeight: 1.5 }}>
                                Ask me to brainstorm a founder story, write a viral carousel, or generate DALL-E prompts.
                            </p>
                        </div>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div key={msg.id} style={{
                            display: "flex", gap: "12px",
                            flexDirection: msg.role === "user" ? "row-reverse" : "row"
                        }}>
                            <div style={{
                                width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                background: msg.role === "user" ? "#1e1e1e" : "linear-gradient(135deg, #a855f7, #6366f1)"
                            }}>
                                {msg.role === "user" ? <User size={14} color="#aaa" /> : <Bot size={14} color="#fff" />}
                            </div>
                            <div style={{
                                background: msg.role === "user" ? "#1e1e1e" : "rgba(168, 85, 247, 0.1)",
                                border: msg.role === "user" ? "1px solid #333" : "1px solid rgba(168, 85, 247, 0.2)",
                                padding: "12px 14px", borderRadius: "12px",
                                borderTopRightRadius: msg.role === "user" ? "4px" : "12px",
                                borderTopLeftRadius: msg.role === "assistant" ? "4px" : "12px",
                                maxWidth: "85%", fontSize: "13px", color: "#e0e0e0", lineHeight: 1.5,
                                whiteSpace: "pre-wrap"
                            }}>
                                {msg.content}
                            </div>
                        </div>
                    ))
                )}
                {isLoading && (
                    <div style={{ display: "flex", gap: "12px" }}>
                        <div style={{
                            width: "28px", height: "28px", borderRadius: "50%",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "linear-gradient(135deg, #a855f7, #6366f1)"
                        }}>
                            <Bot size={14} color="#fff" />
                        </div>
                        <div style={{
                            background: "rgba(168, 85, 247, 0.1)", border: "1px solid rgba(168, 85, 247, 0.2)",
                            padding: "12px 14px", borderRadius: "12px", borderTopLeftRadius: "4px",
                            display: "flex", alignItems: "center", gap: "8px"
                        }}>
                            <Loader2 size={14} color="#a855f7" className="animate-spin" />
                            <span style={{ fontSize: "13px", color: "#a855f7" }}>Thinking...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div style={{ padding: "16px", borderTop: "1px solid #2a2a2a", background: "#1a1a1a" }}>
                <div style={{
                    display: "flex", gap: "10px", alignItems: "flex-end",
                    background: "#000", border: "1px solid #333", borderRadius: "12px", padding: "8px 12px",
                    transition: "border-color 0.2s"
                }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "#a855f7"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "#333"; }}
                >
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Draft a hot take about AI in recruiting..."
                        style={{
                            flex: 1, background: "transparent", border: "none", color: "#fff",
                            fontSize: "13px", lineHeight: 1.5, resize: "none", outline: "none",
                            maxHeight: "120px", minHeight: "24px"
                        }}
                        rows={input.split('\n').length > 1 ? Math.min(input.split('\n').length, 5) : 1}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        style={{
                            background: isLoading || !input.trim() ? "#222" : "linear-gradient(135deg, #a855f7, #6366f1)",
                            border: "none", borderRadius: "8px", width: "32px", height: "32px",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
                            transition: "all 0.2s", color: isLoading || !input.trim() ? "#555" : "#fff"
                        }}
                    >
                        <Send size={14} />
                    </button>
                </div>
                <div style={{
                    display: "flex", alignItems: "center", gap: "16px", marginTop: "12px",
                    paddingLeft: "4px"
                }}>
                    <button style={{
                        background: "transparent", border: "none", color: "#888", fontSize: "11px",
                        display: "flex", alignItems: "center", gap: "6px", cursor: "pointer"
                    }}>
                        <ImageIcon size={12} /> Gen Image Idea
                    </button>
                    <button style={{
                        background: "transparent", border: "none", color: "#888", fontSize: "11px",
                        display: "flex", alignItems: "center", gap: "6px", cursor: "pointer"
                    }}>
                        <Film size={12} /> Draft Video Script
                    </button>
                </div>
            </div>
        </div>
    );
}
