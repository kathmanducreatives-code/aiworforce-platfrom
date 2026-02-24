
interface ToggleSwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
}

const ToggleSwitch = ({ checked, onChange }: ToggleSwitchProps) => {
    return (
        <button
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                width: "44px",
                height: "24px",
                borderRadius: "9999px",
                border: "2px solid transparent",
                cursor: "pointer",
                transition: "background-color 0.2s ease",
                backgroundColor: checked ? "var(--emerald-500)" : "var(--slate-300)",
                flexShrink: 0,
                outline: "none",
            }}
            onFocus={(e) => {
                e.currentTarget.style.boxShadow = `0 0 0 2px ${checked ? "rgba(16,185,129,0.3)" : "rgba(148,163,184,0.3)"}`;
            }}
            onBlur={(e) => {
                e.currentTarget.style.boxShadow = "none";
            }}
        >
            <span
                style={{
                    display: "block",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    backgroundColor: "#ffffff",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                    transition: "transform 0.2s ease",
                    transform: checked ? "translateX(21px)" : "translateX(1px)",
                }}
            />
        </button>
    );
};

export default ToggleSwitch;
