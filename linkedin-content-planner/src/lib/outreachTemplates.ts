/**
 * ScreeningPilot LinkedIn Outreach — Pre‑Built Sequence Templates
 *
 * Three proven DM sequences targeting different founder pain signals.
 * Each sequence has 4 steps: Connection Note → DM 1 → DM 2 → DM 3
 */

export interface SequenceTemplate {
    id: string;
    name: string;
    description: string;
    bestFor: string;
    tag: string;
    color: string;
    steps: SequenceStepTemplate[];
}

export interface SequenceStepTemplate {
    stepNumber: number;
    type: 'connection_request' | 'linkedin_dm';
    delayDays: number;
    condition: string;
    template: string;
    geminiPrompt: string;
    maxChars: number;
}

export const SEQUENCE_TEMPLATES: SequenceTemplate[] = [
    {
        id: 'seq-hiring-pain',
        name: 'The Hiring Pain',
        description: 'For founders/CEOs with active job postings — hiring signal detected.',
        bestFor: 'Companies actively hiring (job posts visible on LinkedIn)',
        tag: 'TIER 1',
        color: '#ef4444',
        steps: [
            {
                stepNumber: 1,
                type: 'connection_request',
                delayDays: 0,
                condition: 'Send immediately',
                maxChars: 300,
                template: 'Hi {first_name} — saw {company} is growing the team. Always interesting to connect with founders scaling through the hiring grind. Would love to connect.',
                geminiPrompt: `Write a LinkedIn connection request note (under 300 characters) for:

Name: {contact_name}
Title: {title}
Company: {company}
Signal: {signal}

Rules:
- Reference their specific hiring/growth signal casually
- Sound like a founder connecting with a peer, NOT a salesperson
- No pitch, no product mention, no links
- Warm and genuine
- Under 300 characters strict`,
            },
            {
                stepNumber: 2,
                type: 'linkedin_dm',
                delayDays: 2,
                condition: 'After connection accepted',
                maxChars: 400,
                template: `Thanks for connecting, {first_name}. Been following what {company} is building — {brief signal reference}.

Curious — are you handling recruiting internally or working with agencies right now? Always interested to hear how other founders at your stage approach it.`,
                geminiPrompt: `Write a LinkedIn DM (under 400 characters) to send 2 days after connecting.

Name: {contact_name}
Company: {company}
Signal: {signal}

Goal: Thank them for connecting, reference something specific about their company, then ask a genuine question about how they handle recruiting.

Rules:
- Do NOT mention ScreeningPilot or any product
- Ask about their recruiting approach as genuine curiosity
- Sound like a founder who's interested in their journey
- Keep it conversational — 2-3 short sentences max
- End with a question to invite a reply`,
            },
            {
                stepNumber: 3,
                type: 'linkedin_dm',
                delayDays: 4,
                condition: 'Only if no reply',
                maxChars: 500,
                template: `No worries if you're slammed, {first_name}. Just been thinking about this a lot lately — we were spending almost €30k per senior hire with agencies before we figured out a different approach.

Ended up building something internally. Happy to share what worked if it's ever relevant for {company}.`,
                geminiPrompt: `Write a follow-up LinkedIn DM (under 500 characters). They haven't replied to your first message.

Name: {contact_name}
Company: {company}
Their likely situation: Founder of a growing company, probably paying agencies or doing recruiting themselves

Goal: Share a relatable founder experience about the pain of expensive recruiting. Hint that you found a solution without directly pitching.

Rules:
- Start with an empathetic opener (acknowledge they're busy)
- Share YOUR pain with recruiting costs as a founder story
- Mention you found a different approach — don't name the product
- Offer to share if relevant — no pressure
- This should feel like a founder sharing an experience, not selling
- Under 500 characters`,
            },
            {
                stepNumber: 4,
                type: 'linkedin_dm',
                delayDays: 5,
                condition: 'Only if no reply — FINAL',
                maxChars: 500,
                template: `Last thing from me on this, {first_name} — know you're busy building.

Quick thought: if {company} is making even 5 hires this year at avg €80k salary, that's roughly €40k+ in agency fees. We got that down to under €2k/year.

If that math is ever interesting, happy to show you the 15-minute version. Either way — rooting for {company}'s growth.`,
                geminiPrompt: `Write a final LinkedIn DM (under 500 characters). This is the last message — make it count but keep it respectful.

Name: {contact_name}
Company: {company}
Company size: {company_size}

Goal: Make the cost savings tangible with real numbers, then offer a soft close. Leave the door open.

Rules:
- Acknowledge this is your last message on the topic
- Use specific money math: agency fees vs ScreeningPilot cost
- Tailor the numbers to their company size if possible
- CTA: "happy to show you the 15-minute version" (not "book a demo")
- End with something warm and genuine — you're rooting for them
- No pressure, no urgency tactics, no fake scarcity
- Under 500 characters`,
            },
        ],
    },
    {
        id: 'seq-time-drain',
        name: 'The Time Drain',
        description: 'Solo founders / small teams where the CEO is doing everything.',
        bestFor: 'No HR hire visible, small team, founder stretched thin',
        tag: 'TIER 2',
        color: '#f59e0b',
        steps: [
            {
                stepNumber: 1,
                type: 'connection_request',
                delayDays: 0,
                condition: 'Send immediately',
                maxChars: 300,
                template: 'Hi {first_name} — fellow founder here. Building with a small team is a different kind of challenge. Would love to connect.',
                geminiPrompt: `Write a LinkedIn connection request note (under 300 characters) for a solo founder:

Name: {contact_name}
Company: {company}
Team size: {company_size}

Rules:
- Acknowledge the challenge of building with a small team
- Sound like a peer, not a vendor — you're a founder too
- No pitch, no product, no links
- Under 300 characters`,
            },
            {
                stepNumber: 2,
                type: 'linkedin_dm',
                delayDays: 2,
                condition: 'After connection accepted',
                maxChars: 400,
                template: `Appreciate the connect, {first_name}. Running a {company_size}-person team is no joke — you're probably wearing 10 hats right now.

Quick question: when you need to hire, do you end up doing most of the sourcing yourself? Curious how founders at your stage handle it.`,
                geminiPrompt: `Write a first DM (under 400 characters) for a solo founder running a small team.

Name: {contact_name}
Company: {company}
Team size: {company_size}

Goal: Acknowledge they wear many hats, then ask how they handle recruiting.
Rules: No product, no pitch, genuine curiosity. End with a question.`,
            },
            {
                stepNumber: 3,
                type: 'linkedin_dm',
                delayDays: 4,
                condition: 'Only if no reply',
                maxChars: 500,
                template: `Was thinking about this — when I was in full hiring mode, I was burning 13+ hours a week just on sourcing. LinkedIn searching, resume reviewing, writing outreach. It was eating my actual CEO time.

Found a way to cut that down to under an hour. Happy to share the approach if you're ever in hiring mode at {company}.`,
                geminiPrompt: `Write a follow-up DM (under 500 characters) for a founder who hasn't replied.

Name: {contact_name}
Company: {company}

Goal: Share YOUR experience of spending 13+ hours/week on sourcing. Hint you solved it.
Rules: Founder-to-founder story. Don't name the product. Offer to share approach.`,
            },
            {
                stepNumber: 4,
                type: 'linkedin_dm',
                delayDays: 5,
                condition: 'Only if no reply — FINAL',
                maxChars: 500,
                template: `Last note, {first_name}. The short version: there's a way to paste one LinkedIn profile of your ideal candidate and get 500+ ranked matches with contact info in about 15 minutes. No agencies, no recruiter fees.

If {company} has any hiring coming up, happy to show you how it works. If not — all good, enjoy the build.`,
                geminiPrompt: `Write a final DM (under 500 characters) — last message, make it count.

Name: {contact_name}
Company: {company}

Goal: Make the product tangible — paste one profile, get 500+ matches in 15 min.
Rules: Light, no pressure. "If not — all good." Warm close.`,
            },
        ],
    },
    {
        id: 'seq-agency-breakup',
        name: 'The Agency Breakup',
        description: 'Companies clearly spending on agencies — multiple recent hires visible.',
        bestFor: 'Agency job posts visible, recent extensive hiring, recruiter signals',
        tag: 'TIER 1',
        color: '#a855f7',
        steps: [
            {
                stepNumber: 1,
                type: 'connection_request',
                delayDays: 0,
                condition: 'Send immediately',
                maxChars: 300,
                template: 'Hi {first_name} — noticed {company} has been growing fast. Love seeing founders scale aggressively. Would be great to connect.',
                geminiPrompt: `Write a connection note (under 300 characters) for a CEO whose company is scaling fast.

Name: {contact_name}
Company: {company}
Signal: {signal}

Rules: Reference their growth. Sound like a founder who admires hustle. No pitch.`,
            },
            {
                stepNumber: 2,
                type: 'linkedin_dm',
                delayDays: 2,
                condition: 'After connection accepted',
                maxChars: 500,
                template: `Thanks for connecting. {company}'s growth is impressive — looks like you've been making some key hires.

Out of curiosity — are you using agencies for recruiting or have you built something internally? Reason I ask: I've been obsessing over how founders can cut recruiting costs without sacrificing quality.`,
                geminiPrompt: `Write a first DM (under 500 characters) for a company that's clearly been hiring a lot.

Name: {contact_name}
Company: {company}
Signal: {signal}

Goal: Compliment their growth, then ask about agency vs internal recruiting.
Rules: Frame your question as genuine obsession about recruiting costs. No pitch.`,
            },
            {
                stepNumber: 3,
                type: 'linkedin_dm',
                delayDays: 4,
                condition: 'Only if no reply',
                maxChars: 500,
                template: `Here's why I was asking — the average agency charges 20% of salary per hire. For a senior role at €100k, that's €20k. One hire.

We spent a year building an alternative: paste one ideal candidate's LinkedIn profile, get 1,000+ ranked matches with emails in 15 minutes. Flat fee, unlimited hires.

Would the math behind it be interesting for {company}?`,
                geminiPrompt: `Write a follow-up DM (under 500 characters) revealing the agency cost math.

Name: {contact_name}
Company: {company}

Goal: Make agency fees tangible (20% of salary = €20k per hire), then reveal your alternative.
Rules: This is where you mention the product capability. Numbers make it real. End with a question.`,
            },
            {
                stepNumber: 4,
                type: 'linkedin_dm',
                delayDays: 5,
                condition: 'Only if no reply — FINAL',
                maxChars: 500,
                template: `No worries if the timing isn't right, {first_name}. Last thought:

If {company} makes 10 hires this year, agencies would cost roughly €80-160k. The tool I mentioned costs €1,788/year total.

That's enough savings to hire another person instead of paying a recruiter to find them.

Happy to do a 15-minute walkthrough anytime. Rooting for {company} either way.`,
                geminiPrompt: `Write a final DM (under 500 characters) with the ultimate ROI comparison.

Name: {contact_name}
Company: {company}
Estimated annual hires: {company_size hint}

Goal: agency spend (€80-160k) vs ScreeningPilot (€1,788/yr). Frame savings as "hire another person instead."
Rules: Warm close. No pressure. Rooting for them either way.`,
            },
        ],
    },
];

/**
 * Reply Template Frameworks — for when leads respond to DMs
 */
export interface ReplyTemplate {
    id: string;
    trigger: string;
    label: string;
    template: string;
    color: string;
}

export const REPLY_TEMPLATES: ReplyTemplate[] = [
    {
        id: 'reply-tell-more',
        trigger: 'Interested, tell me more',
        label: '💬 Tell Me More',
        color: '#00e5a0',
        template: `Appreciate the curiosity, {first_name}.

Quick version: you paste one LinkedIn profile of your ideal candidate — our AI analyzes their career DNA and finds every similar professional on LinkedIn. We're talking 500-2,000+ ranked matches with emails, in about 15 minutes.

Flat €149/month, unlimited hires. No per-hire fees.

Happy to do a quick 15-min screen share so you can see it in action. What does your Thursday or Friday look like?`,
    },
    {
        id: 'reply-agency-works',
        trigger: 'We use agencies and it works fine',
        label: '🏢 Agency Rebuttal',
        color: '#3b82f6',
        template: `Totally get it — agencies deliver when they're good. No argument there.

The only question is the math: if you're paying 20% of salary per hire, that's €15-30k per placement. For a company making 10 hires/year, that's potentially €80k+.

Not saying agencies are bad — just that there might be a way to keep the same quality for 98% less. Worth 15 minutes to see if it fits?`,
    },
    {
        id: 'reply-not-hiring',
        trigger: 'Not hiring right now',
        label: '⏸️ Not Hiring',
        color: '#f59e0b',
        template: `Completely fair — no rush at all. When the time comes, just know there's an option that doesn't involve €15k agency fees per hire.

Happy to stay connected. When you do start hiring again, feel free to ping me — I can walk you through it in 15 minutes.`,
    },
    {
        id: 'reply-cost',
        trigger: 'What does it cost?',
        label: '💰 Pricing',
        color: '#a855f7',
        template: `€149/month flat. Unlimited hires, unlimited candidates, unlimited searches. No per-hire fees, no contracts.

To put that in context: one agency hire at €80k salary costs ~€16k in placement fees. ScreeningPilot costs less than that per year, for every hire you make.

Want me to show you how it works? Takes about 15 minutes.`,
    },
    {
        id: 'reply-vs-linkedin',
        trigger: 'How is this different from LinkedIn Recruiter?',
        label: '🔄 vs LinkedIn Recruiter',
        color: '#ef4444',
        template: `LinkedIn Recruiter helps you search manually — you're still building boolean strings, reviewing profiles one by one, and hoping you find enough good people.

ScreeningPilot works differently: you paste one profile of your ideal candidate, and our AI analyzes their entire career trajectory, then finds every matching professional on LinkedIn. It ranks them all by match score, reveals emails, and sends personalized outreach automatically.

LinkedIn Recruiter gives you a search bar. ScreeningPilot gives you a finished, ranked candidate pipeline ready to contact.

Want to see a side-by-side? Takes 15 min.`,
    },
    {
        id: 'reply-book-meeting',
        trigger: 'Let\'s book a meeting',
        label: '📅 Book Meeting',
        color: '#00e5a0',
        template: `Would love that. Here's my calendar: {cal_link}

Pick any slot that works — I'll show you the full workflow in 15 minutes. Looking forward to it, {first_name}.`,
    },
];

/**
 * Default product context for ScreeningPilot
 */
export const SCREENINGPILOT_PRODUCT_CONTEXT = `Company: ScreeningPilot
Product: AI-powered recruiting OS that replaces recruitment agencies. Paste one LinkedIn profile of your ideal candidate → get hundreds of ranked matches with emails and automated outreach in under 15 minutes.

Problem we solve: Founders and CEOs of growing companies (10-200 employees) are either paying recruitment agencies €15,000-30,000 per hire, or spending 13+ hours/week doing sourcing themselves.

Who buys: Founders and CEOs of companies with 10-200 employees making 3-20 hires per year.

Why they buy:
- Saves €80,000+/year vs recruitment agencies (for 10 hires/year)
- Cuts sourcing time by 70%+ (3-4 weeks → under 15 minutes)
- Finds 10-40x more candidates than manual search
- Flat fee of €149/month — unlimited hires, no per-placement fees

Price: €149/month flat. No per-hire fees. Unlimited usage.

Tone: Conversational, founder-to-founder. Peer energy, not sales energy.

DISQUALIFIERS: Companies 500+ employees, fewer than 5 employees, or with large existing HR departments.`;
