import { useState, useEffect, useCallback } from 'react';
import { supabase, TABLES } from '@/lib/supabase';
import { ProfileResult } from "@/types/icp";

const parseJSON = (value: any) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

const extractPhotoUrl = (photoData: any) => {
    if (!photoData) return '/default-avatar.png'; // Or empty string to let UI handle fallback
    if (typeof photoData === 'string' && photoData.startsWith('http')) return photoData;

    const parsed = parseJSON(photoData);
    if (!parsed) return '/default-avatar.png';

    // Handle nested structure: {"url": "...", "sizes": [...]}
    if (parsed.url) return parsed.url;
    if (parsed.sizes && parsed.sizes[0]?.url) return parsed.sizes[0].url;
    if (typeof parsed === 'string' && parsed.startsWith('http')) return parsed;

    return '/default-avatar.png';
};

const extractSkills = (skillsData: any) => {
    const parsed = parseJSON(skillsData);
    if (!parsed || !Array.isArray(parsed)) return [];

    // Handle both formats: ["skill1", "skill2"] or [{"name": "skill1", ...}]
    return parsed.map((skill: any) => {
        if (typeof skill === 'string') return skill;
        if (skill.name) return skill.name;
        return null;
    }).filter(Boolean);
};

const extractEducation = (eduData: any) => {
    const parsed = parseJSON(eduData);
    if (!parsed || !Array.isArray(parsed)) return [];

    return parsed.map((edu: any) => ({
        school: edu.schoolName || edu.school || 'Unknown',
        degree: edu.degree || '',
        field: edu.fieldOfStudy || ''
    }));
};

const extractWorkHistory = (workData: any) => {
    const parsed = parseJSON(workData);
    if (!parsed || !Array.isArray(parsed)) return [];

    return parsed.map((job: any) => ({
        company: job.companyName || job.company || 'Unknown',
        title: job.position || job.title || 'Unknown',
        duration: job.duration || '',
        start: job.startDate?.text || job.start_date || '',
        end: job.endDate?.text || job.end_date || 'Present'
    }));
};

const parseProfile = (profile: any): ProfileResult => ({
    ...profile,
    photo_url: extractPhotoUrl(profile.photo_url),
    top_skills: extractSkills(profile.top_skills),
    education: extractEducation(profile.education),
    work_history: extractWorkHistory(profile.work_history)
});

export const useICPResults = (sessionId: string | undefined) => {
    const [profiles, setProfiles] = useState<ProfileResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [count, setCount] = useState(0);

    const fetchProfiles = useCallback(async () => {
        if (!sessionId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);

            let query = supabase
                .from(TABLES.CANDIDATE_PROFILES)
                .select('*')
                .order('similarity_score', { ascending: false });

            // Strictly filter by session ID if provided
            if (sessionId) {
                query = query.eq('session_id', sessionId);
            }

            const { data, error } = await query;

            if (error) throw error;

            if (data) {
                const parsedProfiles = data.map(p => {
                    try { return parseProfile(p); }
                    catch (e) { console.warn("Failed to parse profile", p, e); return null; }
                }).filter(Boolean) as ProfileResult[];

                setProfiles(parsedProfiles);
                setCount(parsedProfiles.length);
            }
        } catch (err: any) {
            console.error('Error fetching profiles:', err);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        fetchProfiles();

        if (!sessionId) return;

        // Subscription
        const channel = supabase
            .channel(`profiles_${sessionId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: TABLES.CANDIDATE_PROFILES,
                filter: sessionId !== 'test-session-123' ? `session_id=eq.${sessionId}` : undefined
            }, (payload) => {
                console.log("Real-time update received:", payload);
                const newProfile = parseProfile(payload.new);

                setProfiles(prev => {
                    const exists = prev.find(existing => existing.id === newProfile.id);
                    if (exists) return prev;
                    return [...prev, newProfile].sort((a, b) =>
                        (b.similarity_score || 0) - (a.similarity_score || 0)
                    );
                });
                setCount(prev => prev + 1);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [sessionId, fetchProfiles]);

    const refetch = fetchProfiles;

    return { profiles, loading, count, refetch };
};
