import { Clock } from "lucide-react";

interface TimePickerProps {
    value: string;
    onChange: (time: string) => void;
}

const TimePicker = ({ value, onChange }: TimePickerProps) => {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: "8px",
            background: "#141414", border: "1px solid #2a2a2a",
            borderRadius: "10px", padding: "8px 12px",
            transition: "border-color 0.2s ease"
        }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00e5a0"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; }}
        >
            <Clock size={14} color="#00e5a0" />
            <input
                type="time"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{
                    border: "none", outline: "none", background: "transparent",
                    fontSize: "13px", fontWeight: 500, color: "#e0e0e0",
                    fontFamily: "'Inter', sans-serif", width: "100%",
                    colorScheme: "dark"
                }}
            />
        </div>
    );
};

export default TimePicker;
