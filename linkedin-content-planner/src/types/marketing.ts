export interface MarketingTask {
    id: string;
    title: string;
    description: string | null;
    type: string;
    status: 'pending' | 'completed';
    scheduled_date: string | null;
    created_at: string;
    updated_at: string;
}

export interface CreateMarketingTaskInput {
    title: string;
    description?: string;
    type?: string;
    status?: 'pending' | 'completed';
    scheduled_date?: string;
}
