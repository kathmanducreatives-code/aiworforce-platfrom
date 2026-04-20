#!/usr/bin/env python3
"""
Score, deduplicate, and generate DMs for ScreeningPilot leads.
Reads /tmp/all_profiles.json, deduplicates against Supabase,
scores each profile, generates personalized DMs, and outputs SQL.
"""
import json, re

# ─── EXISTING SUPABASE URLs (57 records – do not re-insert) ─────────────────
EXISTING_URLS = set([
    "https://www.linkedin.com/in/sumitdhoopar","https://www.linkedin.com/in/rajsomas",
    "https://www.linkedin.com/in/imranmsyed","https://www.linkedin.com/in/michaelthoy",
    "https://www.linkedin.com/in/chandradekeyser","https://www.linkedin.com/in/vincalek",
    "https://www.linkedin.com/in/koukoumidis","https://www.linkedin.com/in/alex-vacca",
    "https://www.linkedin.com/in/philip-abraham","https://www.linkedin.com/in/bartcant",
    "https://www.linkedin.com/in/bradkilbey","https://www.linkedin.com/in/alexsandovalp",
    "https://www.linkedin.com/in/kyleljohnstone","https://www.linkedin.com/in/cvrajesh",
    "https://www.linkedin.com/in/johnonit","https://www.linkedin.com/in/grace-cupat",
    "https://www.linkedin.com/in/keithsteward","https://www.linkedin.com/in/vincent-mifsud-aa624845",
    "https://www.linkedin.com/in/atulrawat","https://www.linkedin.com/in/john-standish-a1b5489",
    "https://www.linkedin.com/in/nomanshahuk","https://www.linkedin.com/in/venkiz",
    "https://www.linkedin.com/in/denniscagan","https://www.linkedin.com/in/joseluiscarvalho",
    "https://www.linkedin.com/in/mark-edmondson-inflo","https://www.linkedin.com/in/vishalbhallamit",
    "https://www.linkedin.com/in/jeff-taylor-5212115a","https://www.linkedin.com/in/joe-patterson-7ten",
    "https://www.linkedin.com/in/sampaiz","https://www.linkedin.com/in/donnalloyd",
    "https://www.linkedin.com/in/asif-yusuf-56740816","https://www.linkedin.com/in/jupinkerton",
    "https://www.linkedin.com/in/dedicatedhostingexpert","https://www.linkedin.com/in/rick-beckers",
    "https://www.linkedin.com/in/jr-stricker","https://www.linkedin.com/in/shandi-perkins-007899100",
    "https://www.linkedin.com/in/daviddaleroberts","https://www.linkedin.com/in/david-trossell-bb70181",
    "https://www.linkedin.com/in/chris-nichols-1950aa42","https://www.linkedin.com/in/will-ferrer-0339493a",
    "https://www.linkedin.com/in/theauthguy","https://www.linkedin.com/in/benjamin-barnes-bleeped",
    "https://www.linkedin.com/in/herciu-bogdan","https://www.linkedin.com/in/rajroy",
    "https://www.linkedin.com/in/hughfrost","https://www.linkedin.com/in/geoffrey-mcneil-",
    "https://www.linkedin.com/in/fode-toure","https://www.linkedin.com/in/wisesoft",
    "https://www.linkedin.com/in/rosabravo","https://www.linkedin.com/in/jskates",
    "https://www.linkedin.com/in/garypalmerwcs","https://www.linkedin.com/in/andrewcarricarte",
    "https://www.linkedin.com/in/anthonygarone","https://www.linkedin.com/in/neil-gentleman-hobbs-103542104",
    "https://www.linkedin.com/in/mikefloyd","https://www.linkedin.com/in/lewschulman714",
    "https://www.linkedin.com/in/ryanemilligan"
])

RECRUITER_KW = [
    'executive search','staffing agency','headhunter','recruitment agency',
    'search firm','talent search','recruiting agency','staffing firm',
    'talent agency','placement agency','staff augmentation','recruiting firm',
    'permanent placement','executive recruiter','talent recruiter',
]

DECISION_MAKER_PRIMARY = [
    'ceo','founder','co-founder','cofounder','owner','president',
    'chairman','chief executive','managing director','managing partner',
    'general partner',
]
DECISION_MAKER_SECONDARY = [
    'cto','coo','cpo','cro','ciso','chief product','chief revenue',
    'chief operating','chief technology','vp of engineering',
    'vp engineering','head of engineering',
]
PEOPLE_ROLES = [
    'head of people','chief people','vp people','people partner',
    'director of people','vp of people','people operations',
    'chief hr','hr director','vp hr','people leader',
    'head of hr','director of hr','people & culture',
]

HIRING_KW = [
    'hiring','#hiring',"we're hiring","we are hiring",'join our team',
    'now hiring','join us','come join','open roles','looking for',
]
GROWTH_KW = [
    'inc. 5000','inc 5000','yc ','y combinator','techstars','series a',
    'series b','series c','series d','arr','2x','3x','5x','10x',
    'raised','funded','ipo','unicorn','exit','exited','scaled',
    'scale-up','hypergrowth','hyper-growth','fast-growing','fastest growing',
]
TECH_KW = [
    'saas','ai ','ai-',' ai,','software','tech','cloud','platform','api ',
    '.ai','startup','digital','data ','ml ','machine learning','automation',
    'fintech','healthtech','edtech','proptech','devops','cybersecurity',
    'b2b','deep tech','deeptech',
]
FUNDED_KW = [
    'techstars','y combinator','yc ','seed','series ','backed','funded',
    'venture','vc-','pe-backed','vc backed',
]
ADVISOR_KW = ['advisor','consultant','fractional','freelance']


def is_recruiter(hl):
    for kw in RECRUITER_KW:
        if kw in hl:
            return True
    if re.search(r'\brecruiter\b', hl) and 'founder' not in hl and 'ceo' not in hl:
        return True
    return False


def score_profile(p):
    hl = (p.get('headline') or '').lower()
    pos = p.get('currentPosition') or [{}]
    company = (pos[0].get('companyName') or '').lower()
    hiring = p.get('hiring', False)

    if is_recruiter(hl):
        return -99, ['recruiter']

    score = 0
    signals = []

    if any(t in hl for t in DECISION_MAKER_PRIMARY):
        score += 3
        signals.append('decision_maker')
    elif any(t in hl for t in DECISION_MAKER_SECONDARY):
        score += 2
        signals.append('decision_maker')
    elif any(t in hl for t in PEOPLE_ROLES):
        score += 2
        signals.append('people_leader')

    if hiring or any(kw in hl for kw in HIRING_KW):
        score += 3
        signals.append('ACTIVELY_HIRING')

    if any(kw in hl for kw in GROWTH_KW):
        score += 2
        signals.append('growth_signal')

    if any(kw in hl for kw in TECH_KW) or any(
        kw in company for kw in ['tech','ai','software','saas','digital','cloud','data']
    ):
        score += 2
        signals.append('tech_company')

    if any(kw in hl for kw in FUNDED_KW):
        score += 1
        signals.append('funded_startup')

    if any(kw in hl for kw in ADVISOR_KW) and 'founder' not in hl and 'ceo' not in hl:
        score -= 1
        signals.append('advisor_penalty')

    return score, signals


def tier(score):
    if score >= 4: return 'HOT'
    if score >= 2: return 'WARM'
    return 'SKIP'


def first_name(p):
    fn = (p.get('firstName') or '').strip()
    return fn.split()[0] if fn else 'there'


def extract_company(p):
    pos = p.get('currentPosition') or []
    return pos[0].get('companyName', 'your company') if pos else 'your company'


def generate_dm(p, signals, score):
    name = first_name(p)
    company = extract_company(p)
    hl = (p.get('headline') or '').lower()
    is_hiring = 'ACTIVELY_HIRING' in signals
    is_tech = 'tech_company' in signals or 'funded_startup' in signals
    is_people = 'people_leader' in signals

    if is_hiring and is_tech:
        opener = f"Noticed {company} is actively hiring — growth mode."
    elif is_hiring:
        opener = f"Saw you're building the team at {company} right now."
    elif 'growth_signal' in signals:
        opener = f"Impressive trajectory at {company}."
    elif is_people:
        opener = f"Came across your work building people ops at {company}."
    else:
        opener = f"Came across {company} and your profile stood out."

    if is_people:
        value = (
            "ScreeningPilot helps HR and People leaders hire direct — no agency middlemen, "
            "no 15-25% fees. Automated screening gets you qualified candidates faster."
        )
    elif is_tech and score >= 6:
        value = (
            "ScreeningPilot is built for tech teams scaling fast — cuts 15-25% agency fees, "
            "automates screening so you see only the best candidates. No recruiter markup."
        )
    else:
        value = (
            "ScreeningPilot lets you screen and hire direct — cutting 15-25% agency fees "
            "and getting candidates without the middleman."
        )

    cta = "Worth a 10-min look?"
    dm = f"Hi {name}, {opener} {value} {cta}"

    if len(dm) > 295:
        dm = (
            f"Hi {name}, {opener} ScreeningPilot cuts 15-25% agency fees — "
            f"automated screening, hire direct. Worth a 10-min look?"
        )
    if len(dm) > 295:
        dm = (
            f"Hi {name}, building at {company}? ScreeningPilot cuts agency fees "
            f"(15-25%) with automated screening — hire direct. Worth a quick look?"
        )

    return dm[:298]


def esc(s):
    if s is None: return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"


def main():
    raw = json.load(open("/tmp/all_profiles.json"))

    seen_urls = set(EXISTING_URLS)
    qualified = []
    skipped_dup = skipped_recruiter = skipped_low = 0

    for p in raw:
        url = (p.get('linkedinUrl') or '').strip().rstrip('/')
        if not url:
            continue
        if url in seen_urls:
            skipped_dup += 1
            continue
        seen_urls.add(url)

        score, signals = score_profile(p)

        if score == -99:
            skipped_recruiter += 1
            continue

        t = tier(score)
        if t == 'SKIP':
            skipped_low += 1
            continue

        qualified.append({
            'name': f"{p.get('firstName','')} {p.get('lastName','')}".strip(),
            'company': extract_company(p),
            'headline': (p.get('headline') or '').strip(),
            'tier': t,
            'score': score,
            'signals': ', '.join(signals),
            'linkedin_url': url,
            'dm_text': generate_dm(p, signals, score),
        })

    qualified.sort(key=lambda x: x['score'], reverse=True)
    hot = [q for q in qualified if q['tier'] == 'HOT']
    warm = [q for q in qualified if q['tier'] == 'WARM']

    print(f"Total raw profiles:        {len(raw)}")
    print(f"Duplicates skipped:        {skipped_dup}")
    print(f"Recruiters disqualified:   {skipped_recruiter}")
    print(f"Below threshold (SKIP):    {skipped_low}")
    print(f"Qualified (HOT+WARM):      {len(qualified)}")
    print(f"  HOT  (score >= 4):       {len(hot)}")
    print(f"  WARM (score 2-3):        {len(warm)}")
    print()

    # Build SQL
    rows = []
    for q in qualified:
        rows.append(
            f"  ({esc(q['name'])}, {esc(q['company'])}, {esc(q['headline'])}, "
            f"{esc(q['tier'])}, {q['score']}, {esc(q['signals'])}, "
            f"{esc(q['linkedin_url'])}, {esc(q['dm_text'])}, 'pending', 'apify_linkedin_search')"
        )

    sql = (
        "INSERT INTO public.sp_outreach_leads_scored\n"
        "  (name, company, headline, tier, score, signals, linkedin_url, dm_text, status, source)\n"
        "VALUES\n"
        + ",\n".join(rows) + "\n"
        "ON CONFLICT (linkedin_url) DO NOTHING;"
    )

    with open("/tmp/leads_insert.sql", "w") as f:
        f.write(sql)
    with open("/tmp/qualified_leads.json", "w") as f:
        json.dump(qualified, f, indent=2)

    print("SQL  -> /tmp/leads_insert.sql")
    print("JSON -> /tmp/qualified_leads.json")
    print()
    print("── Top 15 HOT leads ─────────────────────────────────────────────")
    for q in hot[:15]:
        print(f"  [{q['score']}] {q['name']} @ {q['company']}")
        print(f"       {q['headline'][:90]}")
        print(f"       Signals: {q['signals']}")
        print(f"       DM: {q['dm_text'][:100]}...")
        print()


if __name__ == "__main__":
    main()
