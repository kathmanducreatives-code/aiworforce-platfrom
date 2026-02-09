import useSWR from 'swr';
import { supabase, TABLES, RPC } from '@/lib/supabase';
import { ICPProfile } from '@/types/icp';
import { useState, useCallback } from 'react';

interface UseICPSessionsOptions {
    pageSize?: number;
    initialPage?: number;
}

interface UseICPSessionsReturn {
    sessions: ICPProfile[];
    isLoading: boolean;
    isValidating: boolean;
    error: Error | null;
    hasMore: boolean;
    loadMore: () => void;
    deleteSessions: (sessionIds: string[]) => Promise<void>;
    refresh: () => void;
    page: number;
}

/**
 * Custom hook for fetching ICP sessions with pagination and caching
 * Uses SWR for stale-while-revalidate strategy
 */
export const useICPSessions = (options: UseICPSessionsOptions = {}): UseICPSessionsReturn => {
    const { pageSize = 20, initialPage = 0 } = options;
    const [page, setPage] = useState(initialPage);

    // Fetcher function for SWR
    const fetcher = async (key: string) => {
        const currentPage = parseInt(key.split(':')[1] || '0');
        const start = 0; // Always fetch from start to accumulate pages
        const end = (currentPage + 1) * pageSize - 1;

        console.log(`[useICPSessions] Fetching sessions page ${currentPage}, range ${start}-${end}`);

        // 1. Try to fetch from proper sessions table with pagination
        const { data: sessionData, error: sessionError } = await supabase
            .from(TABLES.ICP_SESSIONS)
            .select('*')
            .order('created_at', { ascending: false })
            .range(start, end);

        if (sessionError) {
            console.error('[useICPSessions] Error fetching sessions:', sessionError);
            throw sessionError;
        }

        if (sessionData && sessionData.length > 0) {
            console.log(`[useICPSessions] Found ${sessionData.length} sessions in metadata table`);

            // Map Supabase rows to ICPProfile
            const mappedProfiles: ICPProfile[] = sessionData.map((session: any) => ({
                id: session.session_id,
                name: session.profile_name || `Session ${session.session_id.slice(0, 8)}`,
                created_at: session.created_at,
                industries: session.target_industry || [],
                company_size: session.company_size || "Unknown",
                revenue_range: "Unknown",
                location: session.company_location || [],
                hiring_intensity: session.hiring_intensity || "Medium",
                tech_stack: [],
                target_score: 75,
                user_id: session.user_id || "unknown"
            } as ICPProfile));

            return mappedProfiles;
        }

        // 2. Fallback: Group from candidate_profiles if sessions table is empty
        console.log('[useICPSessions] No sessions in metadata, attempting fallback...');

        const { data: candidates, error: candidateError } = await supabase
            .from(TABLES.CANDIDATE_PROFILES)
            .select('session_id, inserted_at')
            .order('inserted_at', { ascending: false })
            .range(start, end * 10); // Fetch more since we'll be grouping

        if (candidateError) throw candidateError;

        if (candidates && candidates.length > 0) {
            // Group by session_id
            const sessionMap = new Map<string, { count: number, latest: string }>();

            candidates.forEach(c => {
                if (!c.session_id) return;
                if (!sessionMap.has(c.session_id)) {
                    sessionMap.set(c.session_id, { count: 0, latest: c.inserted_at });
                }
                const entry = sessionMap.get(c.session_id)!;
                entry.count++;
            });

            // Convert to profiles and limit to page size
            const fallbackProfiles: ICPProfile[] = Array.from(sessionMap.entries())
                .slice(0, (page + 1) * pageSize)
                .map(([sessionId, data]) => ({
                    id: sessionId,
                    name: `Auto-Detected Session (${data.count} candidates)`,
                    created_at: data.latest,
                    industries: [],
                    company_size: "Unknown",
                    revenue_range: "Unknown",
                    location: [],
                    hiring_intensity: "Medium",
                    tech_stack: [],
                    target_score: 0,
                    user_id: "unknown"
                } as ICPProfile));

            return fallbackProfiles;
        }

        return [];
    };

    // Use SWR for data fetching with caching
    const { data, error, isValidating, mutate } = useSWR<ICPProfile[]>(
        `icp_sessions:${page}`,
        fetcher,
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            dedupingInterval: 5000, // Dedupe requests within 5s
            errorRetryCount: 3,
            errorRetryInterval: 2000,
            // Show stale data while revalidating
            keepPreviousData: true,
        }
    );

    const sessions = data || [];
    const hasMore = sessions.length >= (page + 1) * pageSize;

    // Load more function
    const loadMore = useCallback(() => {
        if (!isValidating && hasMore) {
            console.log(`[useICPSessions] Loading page ${page + 1}`);
            setPage(prev => prev + 1);
        }
    }, [isValidating, hasMore, page]);

    // Delete sessions function with optimistic update
    const deleteSessions = useCallback(async (sessionIds: string[]) => {
        if (!sessionIds || sessionIds.length === 0) return;

        console.log(`[useICPSessions] Deleting ${sessionIds.length} sessions:`, sessionIds);

        // Optimistic update - remove from UI immediately
        const currentSessions = data || [];
        const optimisticUpdate = currentSessions.filter(s => !sessionIds.includes(s.id));
        mutate(optimisticUpdate, false); // Update without revalidation

        try {
            // Use standard Supabase delete with .in() instead of RPC
            // This works without requiring database migration
            const { error } = await supabase
                .from(TABLES.ICP_SESSIONS)
                .delete()
                .in('session_id', sessionIds);

            if (error) {
                console.error('[useICPSessions] Bulk delete error:', error);
                // Revert optimistic update on error
                mutate(currentSessions, false);
                throw error;
            }

            console.log(`[useICPSessions] Successfully deleted ${sessionIds.length} sessions`);

            // Also delete related candidates (since we might not have CASCADE configured)
            const { error: candidateError } = await supabase
                .from(TABLES.CANDIDATE_PROFILES)
                .delete()
                .in('session_id', sessionIds);

            if (candidateError) {
                console.warn('[useICPSessions] Warning: Could not delete related candidates:', candidateError);
                // Don't throw - session is already deleted
            }

            // Revalidate to get fresh data
            mutate();
        } catch (error) {
            console.error('[useICPSessions] Delete failed:', error);
            throw error;
        }
    }, [data, mutate]);

    // Refresh function
    const refresh = useCallback(() => {
        mutate();
    }, [mutate]);

    return {
        sessions,
        isLoading: !error && !data,
        isValidating,
        error: error || null,
        hasMore,
        loadMore,
        deleteSessions,
        refresh,
        page,
    };
};
