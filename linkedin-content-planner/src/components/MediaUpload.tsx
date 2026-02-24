import { useRef, useState } from "react";
import { Upload, X, Image as ImageIcon, Video, Loader2 } from "lucide-react";

interface MediaUploadProps {
    fileBase64: string | null;
    fileName: string | null;
    fileType: "image" | "video" | null;
    onUpload: (base64: string, name: string, type: "image" | "video") => void;
    onRemove: () => void;
}

const MediaUpload = ({ fileBase64, fileName, fileType, onUpload, onRemove }: MediaUploadProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [processing, setProcessing] = useState(false);

    const handleFile = (file: File) => {
        if (!file) return;
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");

        if (!isImage && !isVideo) {
            alert("Please upload an image or video file.");
            return;
        }

        setProcessing(true);
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            // Provide full base64 string (including data prefix)
            onUpload(base64, file.name, isImage ? "image" : "video");
            setProcessing(false);
        };
        reader.readAsDataURL(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    if (fileBase64) {
        return (
            <div style={{
                borderRadius: "10px", border: "1px solid #2a2a2a",
                background: "#141414", padding: "10px",
                position: "relative", overflow: "hidden"
            }}>
                <button
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    style={{
                        position: "absolute", top: "8px", right: "8px",
                        background: "rgba(0,229,160,0.15)", color: "#00e5a0",
                        border: "1px solid rgba(0,229,160,0.3)", borderRadius: "50%",
                        width: "24px", height: "24px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", zIndex: 10
                    }}
                >
                    <X size={14} />
                </button>

                <div style={{
                    height: "140px", borderRadius: "6px", overflow: "hidden",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "#000", marginBottom: "8px"
                }}>
                    {fileType === "image" ? (
                        <img src={fileBase64} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : (
                        <video src={fileBase64} style={{ width: "100%", height: "100%", objectFit: "contain" }} controls />
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#888" }}>
                    {fileType === "image" ? <ImageIcon size={12} color="#00e5a0" /> : <Video size={12} color="#00e5a0" />}
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px" }}>
                        {fileName}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            style={{
                borderRadius: "10px",
                border: `1px dashed ${dragging ? "#00e5a0" : "#2a2a2a"}`,
                background: dragging ? "rgba(0,229,160,0.05)" : "#141414",
                padding: "20px", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: "8px",
                cursor: "pointer", transition: "all 0.2s ease",
                minHeight: "100px"
            }}
        >
            <input
                type="file"
                ref={inputRef}
                onChange={(e) => e.target.files && handleFile(e.target.files[0])}
                style={{ display: "none" }}
                accept="image/*,video/*"
            />

            {processing ? (
                <Loader2 size={20} className="animate-spin" color="#00e5a0" />
            ) : (
                <>
                    <div style={{
                        width: "32px", height: "32px", borderRadius: "50%",
                        background: "rgba(0,229,160,0.1)", display: "flex",
                        alignItems: "center", justifyContent: "center"
                    }}>
                        <Upload size={16} color="#00e5a0" />
                    </div>
                    <span style={{ fontSize: "12px", color: "#666", textAlign: "center" }}>
                        <span style={{ fontWeight: 600, color: "#00e5a0" }}>Click to upload</span> or drag and drop
                    </span>
                    <span style={{ fontSize: "10px", color: "#444" }}>
                        JPG, PNG, MP4 (max 10MB)
                    </span>
                </>
            )}
        </div>
    );
};

export default MediaUpload;
