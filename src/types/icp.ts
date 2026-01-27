// TypeScript interfaces for ICP Management
export interface ICPProfile {
    id: string;
    name: string;
    industries: string[];
    revenue_range: string;
    company_size: string;
    tech_stack: string[];
    scoring_weights: {
        industry: number;
        revenue: number;
        size: number;
        tech: number;
    };
    target_score?: number;
    created_at: string;
    updated_at?: string;
}

export interface ICPFormData {
    name: string;
    industries: string[];
    revenue_range: string;
    company_size: string;
    tech_stack: string[];
    scoring_weights: {
        industry: number;
        revenue: number;
        size: number;
        tech: number;
    };
}

export const REVENUE_RANGES = [
    { value: 'under_1m', label: 'Under $1M' },
    { value: '1m_10m', label: '$1M - $10M' },
    { value: '10m_50m', label: '$10M - $50M' },
    { value: '50m_100m', label: '$50M - $100M' },
    { value: 'over_100m', label: 'Over $100M' },
];

export const COMPANY_SIZES = [
    { value: '1_10', label: '1-10 employees' },
    { value: '11_50', label: '11-50 employees' },
    { value: '51_200', label: '51-200 employees' },
    { value: '201_500', label: '201-500 employees' },
    { value: '501_1000', label: '501-1000 employees' },
    { value: 'over_1000', label: '1000+ employees' },
];

export const TECH_STACK_OPTIONS = [
    // CRM
    { category: 'CRM', value: 'salesforce', label: 'Salesforce' },
    { category: 'CRM', value: 'hubspot', label: 'HubSpot' },
    { category: 'CRM', value: 'pipedrive', label: 'Pipedrive' },
    { category: 'CRM', value: 'zoho', label: 'Zoho CRM' },

    // Marketing
    { category: 'Marketing', value: 'marketo', label: 'Marketo' },
    { category: 'Marketing', value: 'pardot', label: 'Pardot' },
    { category: 'Marketing', value: 'mailchimp', label: 'Mailchimp' },
    { category: 'Marketing', value: 'sendgrid', label: 'SendGrid' },

    // Analytics
    { category: 'Analytics', value: 'segment', label: 'Segment' },
    { category: 'Analytics', value: 'mixpanel', label: 'Mixpanel' },
    { category: 'Analytics', value: 'amplitude', label: 'Amplitude' },
    { category: 'Analytics', value: 'google_analytics', label: 'Google Analytics' },

    // Sales
    { category: 'Sales', value: 'outreach', label: 'Outreach' },
    { category: 'Sales', value: 'salesloft', label: 'SalesLoft' },
    { category: 'Sales', value: 'gong', label: 'Gong' },
    { category: 'Sales', value: 'chorus', label: 'Chorus.ai' },

    // DevTools
    { category: 'DevTools', value: 'github', label: 'GitHub' },
    { category: 'DevTools', value: 'gitlab', label: 'GitLab' },
    { category: 'DevTools', value: 'jira', label: 'Jira' },
    { category: 'DevTools', value: 'confluence', label: 'Confluence' },
];
