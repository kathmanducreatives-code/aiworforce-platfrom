export interface TieredIndustry {
    id: string;
    label: string;
    subcategories: { id: string; label: string }[];
}

export const TAXONOMY: TieredIndustry[] = [
    {
        id: "software_it",
        label: "Software & IT",
        subcategories: [
            { id: "saas", label: "SaaS" },
            { id: "cloud_infrastructure", label: "Cloud Infrastructure" },
            { id: "cybersecurity", label: "Cybersecurity" },
            { id: "ai_ml", label: "AI & Machine Learning" },
            { id: "fintech", label: "FinTech" },
            { id: "healthtech", label: "HealthTech" },
            { id: "dev_tools", label: "Developer Tools" },
            { id: "martech", label: "MarTech" },
            { id: "edtech", label: "EdTech" },
            { id: "ecommerce_platforms", label: "E-Commerce Platforms" }
        ]
    },
    {
        id: "professional_services",
        label: "Professional Services",
        subcategories: [
            { id: "agency_consulting", label: "Agency & Consulting" },
            { id: "legal_services", label: "Legal Services" },
            { id: "hr_tech", label: "HR Tech & Recruiting" },
            { id: "marketing_advertising", label: "Marketing & Advertising" },
            { id: "pr_comms", label: "PR & Communications" },
            { id: "design_creative", label: "Design & Creative Services" },
            { id: "it_consulting", label: "IT Consulting" }
        ]
    },
    {
        id: "modern_finance",
        label: "Modern Finance",
        subcategories: [
            { id: "vc_pe", label: "Venture Capital & Private Equity" },
            { id: "crypto_web3", label: "Crypto & Web3" },
            { id: "investment_banking", label: "Investment Banking" },
            { id: "wealth_management", label: "Wealth Management" },
            { id: "insurtech", label: "InsurTech" },
            { id: "digital_banking", label: "Digital Banking" }
        ]
    }
];
