import { FileText } from "lucide-react";

interface StatCardProps {
    icon: typeof FileText;
    label: string;
    value: number | string;
    color: string;
}

const StatCard = ({ icon: Icon, label, value, color }: StatCardProps) => (
    <div style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "14px 16px", borderRadius: "14px",
        background: "#141414", border: "1px solid #1e1e1e",
    }}>
        <div style={{
            width: "36px", height: "36px", borderRadius: "10px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `${color}12`, flexShrink: 0,
        }}>
            <Icon size={18} color={color} />
        </div>
        <div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#e0e0e0", lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: "11px", color: "#444", fontWeight: 500, marginTop: "2px" }}>{label}</div>
        </div>
    </div>
);

export default StatCard;
