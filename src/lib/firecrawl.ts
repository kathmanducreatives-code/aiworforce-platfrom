/**
 * Custom browser-safe Firecrawl client using REST API directly.
 * The official @mendable/firecrawl-js SDK relies heavily on Node-native modules
 * (fs, path, undici) which cause Vite/React to permanently crash on mount.
 */

class BrowserFirecrawl {
    private apiKey: string;
    private baseUrl = 'https://api.firecrawl.dev/v1';

    constructor(config: { apiKey: string }) {
        this.apiKey = config.apiKey;
    }

    async scrapeUrl(url: string, params: any = {}) {
        const response = await fetch(`${this.baseUrl}/scrape`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({ url, ...params })
        });

        if (!response.ok) {
            throw new Error(`Firecrawl API error: ${response.statusText}`);
        }

        return response.json();
    }

    async search(query: string, params: any = {}) {
        const response = await fetch(`${this.baseUrl}/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({ query, ...params })
        });

        if (!response.ok) {
            throw new Error(`Firecrawl API error: ${response.statusText}`);
        }

        return response.json();
    }

    async crawlUrl(url: string, params: any = {}) {
        const response = await fetch(`${this.baseUrl}/crawl`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({ url, ...params })
        });

        if (!response.ok) {
            throw new Error(`Firecrawl API error: ${response.statusText}`);
        }

        return response.json();
    }
}

export const firecrawl = new BrowserFirecrawl({
    apiKey: import.meta.env.VITE_FIRECRAWL_API_KEY
});
