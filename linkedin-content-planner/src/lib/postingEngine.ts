/**
 * LinkedIn Optimal Posting Time Engine
 * 
 * Based on aggregated LinkedIn engagement data:
 * - Best days: Tuesday > Wednesday > Thursday > Monday > Friday
 * - Weekend posts get 30-50% less engagement
 * - Peak times vary by day for maximum reach
 * 
 * Sources: HubSpot 2024, Sprout Social 2024, Buffer 2024 research
 */

export interface PostingSlot {
    date: string;       // YYYY-MM-DD
    time: string;       // HH:MM
    dayName: string;    // e.g. "Tuesday"
    score: number;      // 1-10 engagement score
    reason: string;     // Why this slot is good
}

// Engagement score by day of week (0=Sun, 6=Sat)
const DAY_SCORES: Record<number, { score: number; label: string }> = {
    0: { score: 3, label: 'Sunday — Low engagement, but less competition' },
    1: { score: 7, label: 'Monday — Professionals catching up, good reach' },
    2: { score: 10, label: 'Tuesday — Peak LinkedIn day, highest engagement' },
    3: { score: 9, label: 'Wednesday — Strong mid-week activity' },
    4: { score: 8, label: 'Thursday — Great for thought leadership' },
    5: { score: 6, label: 'Friday — Decent, but drops after noon' },
    6: { score: 2, label: 'Saturday — Low activity, skip if possible' },
};

// Optimal posting times per day (ranked best to good)
const OPTIMAL_TIMES: Record<number, string[]> = {
    0: ['10:00', '11:00'],                           // Sunday: late morning if posting
    1: ['07:30', '10:00', '12:00'],                   // Monday: early birds + lunch
    2: ['08:00', '10:00', '12:00', '17:30'],          // Tuesday: all peak windows
    3: ['08:00', '09:30', '12:00', '17:00'],          // Wednesday: similar pattern
    4: ['07:30', '09:00', '12:00', '17:00'],          // Thursday: early morning wins
    5: ['07:30', '10:00', '12:00'],                   // Friday: morning only (drops PM)
    6: ['10:00', '11:00'],                            // Saturday: late morning if posting
};

// Content format to best day mapping for even better optimization
const FORMAT_DAY_PREFERENCE: Record<string, number[]> = {
    'Storytelling': [2, 3],    // Tue/Wed — people have time to read
    'Statistics': [2, 4],    // Tue/Thu — data-driven audiences active
    'Customer Testimonial': [3, 4],    // Wed/Thu — decision-makers browsing
    'How It Works': [1, 2],    // Mon/Tue — educational content performs well
    'Behind the Scenes': [5, 4],    // Fri/Thu — lighter content for end of week
    'Thought Leadership': [2, 3],    // Tue/Wed — highest share rates
    'Hot Take': [2, 3],    // Tue/Wed — controversy drives engagement
    'Carousel': [2, 3, 4], // Mid-week — carousels get 3x engagement
    'Comic Strip': [3, 5],    // Wed/Fri — visual content breaks up the week
    'Data Visual': [2, 4],    // Tue/Thu — data crowd is active
    'Short Video': [2, 3],    // Tue/Wed — video gets priority in feed
    'Founder Story': [1, 4],    // Mon/Thu — inspirational start/end of week
};

/**
 * Get the optimal time for a specific date
 */
export function getOptimalTimeForDate(date: Date): string {
    const dayOfWeek = date.getDay();
    const times = OPTIMAL_TIMES[dayOfWeek] || ['08:00'];
    // Return the best time for that day (first in the array)
    return times[0];
}

/**
 * Get the engagement score for a date
 */
export function getEngagementScore(date: Date): { score: number; label: string } {
    return DAY_SCORES[date.getDay()] || { score: 5, label: 'Unknown' };
}

/**
 * Generate a smart 30-day schedule starting from a given date.
 * Prioritizes high-engagement days and assigns optimal times.
 * Skips weekends by default (configurable).
 */
export function generateSmartSchedule(
    startDate: Date,
    totalDays: number = 30,
    contentFormats: string[] = [],
    skipWeekends: boolean = false
): PostingSlot[] {
    const slots: PostingSlot[] = [];
    const current = new Date(startDate);
    let assigned = 0;
    let timeRotationIndex = 0;

    while (assigned < totalDays) {
        const dayOfWeek = current.getDay();

        // Skip weekends if configured
        if (skipWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
            current.setDate(current.getDate() + 1);
            continue;
        }

        const dayInfo = DAY_SCORES[dayOfWeek];
        const times = OPTIMAL_TIMES[dayOfWeek] || ['08:00'];

        // Rotate through optimal times for variety
        const time = times[timeRotationIndex % times.length];
        timeRotationIndex++;

        const dateStr = current.toISOString().split('T')[0];
        const dayName = current.toLocaleDateString('en-US', { weekday: 'long' });

        // Boost score if content format matches ideal day
        let score = dayInfo.score;
        const format = contentFormats[assigned] || '';
        const preferredDays = FORMAT_DAY_PREFERENCE[format];
        if (preferredDays && preferredDays.includes(dayOfWeek)) {
            score = Math.min(10, score + 1); // Bonus for format-day match
        }

        slots.push({
            date: dateStr,
            time,
            dayName,
            score,
            reason: dayInfo.label + (score > dayInfo.score ? ' + Format boost!' : ''),
        });

        assigned++;
        current.setDate(current.getDate() + 1);
    }

    return slots;
}

/**
 * Get a human-readable summary of why a time slot is good
 */
export function getTimingInsight(time: string, _dayOfWeek: number): string {
    const hour = parseInt(time.split(':')[0]);

    if (hour >= 7 && hour < 9) return '🌅 Morning commute — professionals scrolling before work';
    if (hour >= 9 && hour < 11) return '☕ Mid-morning — peak focus time, high-quality engagement';
    if (hour >= 11 && hour < 13) return '🍽️ Lunch break — highest click-through rates';
    if (hour >= 16 && hour < 18) return '🌆 Evening wind-down — people browsing before leaving';
    return '📱 Off-peak — less competition, still decent reach';
}
