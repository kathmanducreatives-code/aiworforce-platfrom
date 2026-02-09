export interface Region {
    id: string;
    label: string;
    countries: string[];
}

export const REGIONAL_LOCATIONS: Region[] = [
    {
        id: "north_america",
        label: "North America",
        countries: ["United States", "Canada", "Mexico"]
    },
    {
        id: "emea",
        label: "EMEA",
        countries: [
            "United Kingdom", "Germany", "France", "Netherlands", "Sweden",
            "Switzerland", "Ireland", "Spain", "Italy", "Israel", "United Arab Emirates",
            "Saudi Arabia", "South Africa"
        ]
    },
    {
        id: "apac",
        label: "APAC",
        countries: [
            "Australia", "New Zealand", "Singapore", "Japan", "India",
            "South Korea", "Hong Kong", "Indonesia", "Malaysia", "Philippines"
        ]
    },
    {
        id: "latam",
        label: "LATAM",
        countries: [
            "Brazil", "Argentina", "Chile", "Colombia", "Peru"
        ]
    }
];

// Helper to get all flattened countries for search
export const ALL_COUNTRIES = REGIONAL_LOCATIONS.flatMap(r => r.countries).sort();
