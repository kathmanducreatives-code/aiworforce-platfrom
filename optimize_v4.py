import json

INPUT_PATH = './icp_lookalike_engine_v3_final.json'
OUTPUT_PATH = 'icp_lookalike_engine_v4_final.json'

def create_optimized_prompt_v4():
    """Generate the refined tier-aware AI prompt with explicit degradation rules"""
    return '''// ============================================================
// TIER-AWARE STRATEGY CONTEXT BUILDER v4
// Includes explicit tier degradation logic
// ============================================================
const session = $("Retrieve Full Session").first().json;

let profile = {};
try {
  profile = $("Extract Profile Data").first().json.profile || {};
} catch (e) {
  const raw = session.lookalike_profile_data;
  profile = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : {};
}

const profile_name = session.profile_name || 'Not Provided';
const safeParse = (v, d) => { if (!v) return d; if (typeof v === 'object') return v; try { return JSON.parse(v) || d; } catch { return d; } };
const industries = safeParse(session.target_industry_names, []);
const industryIds = safeParse(session.industry_ids, []);
const locations = safeParse(session.company_location, []);
const company_size = safeParse(session.company_size, '');
const hiring_intensity = session.hiring_intensity || 'medium';
const persona_description = session.persona_description || '';

const lookalike = {
  name: profile.name || 'Unknown',
  title: profile.current_title || '',
  company: profile.current_company || '',
  location: profile.location || '',
  skills: profile.top_skills || [],
  education: profile.education || [],
  work_history: profile.work_history || [],
  years_experience: profile.total_years_experience || 0,
  seniority_level: profile.seniority_level || 'Mid',
  headline: profile.headline || ''
};

const primaryIndustry = lookalike.work_history?.[0]?.industry || industries[0] || '';

// ============================================================
// TIER-AWARE AI PROMPT WITH DEGRADATION RULES
// ============================================================
const prompt = `You are a LinkedIn talent search strategist. Generate TIER-SPECIFIC search parameters with progressive degradation from Tier 1 → Tier 2 → Tier 3.

═══════════════════════════════════════════════════════════════
CRITICAL CONTEXT: 3-TIER WATERFALL SEARCH
═══════════════════════════════════════════════════════════════

User requests: X candidates (e.g., 100)

TIER 1 (HIGH PRECISION): Should deliver 70-100% of target with excellent quality
- If Tier 1 returns ≥80% → STOP (mission accomplished)
- If Tier 1 returns <80% → Continue to Tier 2

TIER 2 (EXPANDED REACH): Fallback with loosened filters
- If Tier 1 + Tier 2 ≥85% → STOP
- If still short → Continue to Tier 3

TIER 3 (SAFETY NET): Emergency fallback with very broad filters

YOUR GOAL: Make Tier 1 so precise it delivers 70-100 matches, minimizing Tier 2/3 dependency.

═══════════════════════════════════════════════════════════════
PROFILE ANALYSIS
═══════════════════════════════════════════════════════════════

Name: ${lookalike.name}
Current Title: ${lookalike.title}
Headline: ${lookalike.headline}
Company: ${lookalike.company}
Primary Industry: ${primaryIndustry}
Location: ${lookalike.location}
Years of Experience: ${lookalike.years_experience}
Seniority Level: ${lookalike.seniority_level}
Top Skills: ${lookalike.skills.slice(0, 10).join(', ')}
Work History: ${JSON.stringify(lookalike.work_history.slice(0, 3))}

USER REQUIREMENTS:
Target Role: ${persona_description}
Target Industries: ${industries.join(', ')}
Target Locations: ${locations.join(', ')}
Company Size: ${company_size}

═══════════════════════════════════════════════════════════════
TIER 1: MAXIMUM PRECISION (Target: 70-100% of goal)
═══════════════════════════════════════════════════════════════

Goal: Find near-identical professionals in the exact same niche

INCLUDE:
✅ Niche-specific searchQuery with quoted phrases (e.g., "B2B SaaS recruiting")
✅ Specific job titles (2-3 core titles like CEO, Founder, Managing Partner)
✅ 3-5 niche skills (e.g., SaaS, Executive Search, Employer Branding)
✅ Exact industry IDs (1 primary industry, e.g., 104 for Staffing & Recruiting)
✅ Target locations (use user-provided: ${JSON.stringify(locations)})
✅ Seniority level filter (exact match, e.g., Executive: 320, 400)
✅ Experience range ±5 years (e.g., ${lookalike.years_experience} years → map to IDs)
   - 0-2 years → ID "1"
   - 3-5 years → ID "2"
   - 6-10 years → ID "3"
   - 11-15 years → ID "4"
   - 16-20 years → ID "5"
   - 21+ years → ID "6"
✅ Niche qualifiers in query (scale-up, unicorn, Series A-D)
✅ Specific sub-industry exclusions (e.g., -"healthcare staffing" -"retail recruiting")

ALWAYS EMPTY (CRITICAL):
❌ currentCompanies: [] (we want SIMILAR people from DIFFERENT companies)
❌ pastCompanies: [] (too restrictive)
❌ pastJobTitles: [] (too restrictive)
❌ schools: [] (not relevant unless educational search)

TIER 1 EXAMPLE:
{
  "searchQuery": "(CEO OR Founder OR \\"Managing Partner\\") AND (\\"B2B SaaS recruiting\\" OR \\"SaaS talent acquisition\\") AND (scale-up OR unicorn) -\\"healthcare staffing\\" -\\"retail recruiting\\"",
  "currentJobTitles": ["Founder & CEO", "Managing Partner"],
  "pastJobTitles": [],
  "currentCompanies": [],
  "pastCompanies": [],
  "skills": ["Software as a Service (SaaS)", "SaaS Sales", "Executive Search", "Employer Branding"],
  "industryIds": ["104"],
  "locations": ${JSON.stringify(locations)},
  "seniorityLevelIds": ["320", "400"],
  "yearsOfExperienceIds": ["4", "5"],
  "schools": [],
  "profileLanguages": ["English"],
  "profileScraperMode": "Full",
  "maxItems": 100
}

═══════════════════════════════════════════════════════════════
TIER 2: EXPANDED REACH (Only if Tier 1 < 80% of goal)
═══════════════════════════════════════════════════════════════

Goal: Broaden to adjacent niches and slightly lower seniority

DROP/LOOSEN (~30% degradation):
🔽 Niche specificity: "B2B SaaS recruiting" → broader "SaaS OR software OR tech"
🔽 Skills: Reduce from 4 skills → 1-2 skills (more general)
🔽 Job titles: Add adjacent roles (CEO, Founder, VP Talent, Director)
🔽 Industries: Add 1-2 adjacent industries (e.g., add 96 "IT Services")
🔽 Seniority: Expand down one level (add 300, 310 if looking for 320, 400)
🔽 Experience: Widen range ±8 years (e.g., ${lookalike.years_experience} years → wider IDs)
🔽 Query qualifiers: Remove specific qualifiers (drop "scale-up", "unicorn")
🔽 Exclusions: Broader exclusions (-healthcare -retail instead of -"healthcare staffing")

KEEP:
✅ Core job titles (CEO, Founder)
✅ Target locations (same as Tier 1)
✅ Industry filter (but expanded)

STILL EMPTY:
❌ currentCompanies: []
❌ pastCompanies: []
❌ pastJobTitles: []
❌ schools: []

TIER 2 EXAMPLE:
{
  "searchQuery": "(CEO OR Founder OR \\"VP Talent\\" OR Director) AND (SaaS OR software OR technology) AND recruiting -healthcare -retail",
  "currentJobTitles": ["CEO", "Founder", "VP", "Director"],
  "pastJobTitles": [],
  "currentCompanies": [],
  "pastCompanies": [],
  "skills": ["SaaS", "Recruitment"],
  "industryIds": ["104", "96"],
  "locations": ${JSON.stringify(locations)},
  "seniorityLevelIds": ["300", "310", "320", "400"],
  "yearsOfExperienceIds": ["3", "4", "5"],
  "schools": [],
  "profileLanguages": ["English"],
  "profileScraperMode": "Full",
  "maxItems": 100
}

═══════════════════════════════════════════════════════════════
TIER 3: SAFETY NET (Only if Tier 1 + Tier 2 < 85% of goal)
═══════════════════════════════════════════════════════════════

Goal: Broad industry search to fill remaining gap

DROP/LOOSEN (~60% degradation):
🔽 Niche completely: Remove all niche keywords, go generic (recruiting OR staffing)
🔽 Skills: EMPTY [] (no skill filtering)
🔽 Job titles: Expand to all leadership (CEO, Founder, Owner, President, Partner)
🔽 Industries: Add more related industries (e.g., 107 "Human Resources Services")
🔽 Seniority: EMPTY [] (accept all seniority levels)
🔽 Experience: EMPTY [] (accept all experience levels)
🔽 Query: Simplest possible (title + industry - major exclusions)
🔽 Exclusions: Only exclude clearly wrong industries (-healthcare -retail -nonprofit)

KEEP:
✅ Basic job titles (CEO, Founder, Owner)
✅ Target locations (same as Tier 1)
✅ Core industry (104 Staffing & Recruiting)

STILL EMPTY:
❌ currentCompanies: []
❌ pastCompanies: []
❌ pastJobTitles: []
❌ schools: []

TIER 3 EXAMPLE:
{
  "searchQuery": "(CEO OR Founder OR Owner OR President) AND (recruiting OR staffing) -healthcare -retail -nonprofit",
  "currentJobTitles": [],
  "pastJobTitles": [],
  "currentCompanies": [],
  "pastCompanies": [],
  "skills": [],
  "industryIds": ["104", "96", "107"],
  "locations": ${JSON.stringify(locations)},
  "seniorityLevelIds": [],
  "yearsOfExperienceIds": [],
  "schools": [],
  "profileLanguages": ["English"],
  "profileScraperMode": "Full",
  "maxItems": 100
}

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only, no markdown)
═══════════════════════════════════════════════════════════════

{
  "role_family": "<recruiting|engineering|sales|marketing|finance|operations|legal|healthcare|design|product|data|hr|executive|consulting|other>",
  "primary_industry": "<THE MAIN INDUSTRY>",
  "niche_specialization": "<EXTRACTED NICHE e.g. 'B2B SaaS recruiting', 'fintech sales'>",
  "mandatory_signals": {
    "job_titles": ["<3-5 core titles>"],
    "keywords": ["<5-8 niche-specific keywords>"],
    "industries": ["<industry IDs>"]
  },
  "supportive_signals": {
    "skills": ["<3-5 differentiating skills>"],
    "past_companies": [],
    "certifications": []
  },
  "excluded": {
    "role_families": ["<role families to exclude>"],
    "industries": ["<industry NAMES>"],
    "keywords": ["<specific sub-industry keywords>"]
  },
  "generated_strategy": "<1-2 sentence explanation>",
  "search_logic_dna": "<technical summary>",
  "tier_1_params": {
    "searchQuery": "<PRECISE query with niche phrases>",
    "currentJobTitles": ["<2-3 specific titles>"],
    "pastJobTitles": [],
    "currentCompanies": [],
    "pastCompanies": [],
    "skills": ["<3-5 required skills>"],
    "industryIds": ["<1 exact ID>"],
    "locations": ${JSON.stringify(locations)},
    "seniorityLevelIds": ["<exact seniority IDs>"],
    "yearsOfExperienceIds": ["<±5 year tolerance>"],
    "schools": [],
    "profileLanguages": ["English"],
    "profileScraperMode": "Full",
    "maxItems": 100
  },
  "tier_2_params": {
    "searchQuery": "<EXPANDED query>",
    "currentJobTitles": ["<4-5 titles + adjacent>"],
    "pastJobTitles": [],
    "currentCompanies": [],
    "pastCompanies": [],
    "skills": ["<1-2 skills>"],
    "industryIds": ["<2-3 IDs including adjacent>"],
    "locations": ${JSON.stringify(locations)},
    "seniorityLevelIds": ["<expanded range>"],
    "yearsOfExperienceIds": ["<±8 year tolerance>"],
    "schools": [],
    "profileLanguages": ["English"],
    "profileScraperMode": "Full",
    "maxItems": 100
  },
  "tier_3_params": {
    "searchQuery": "<BROAD query>",
    "currentJobTitles": [],
    "pastJobTitles": [],
    "currentCompanies": [],
    "pastCompanies": [],
    "skills": [],
    "industryIds": ["<3-4 related IDs>"],
    "locations": ${JSON.stringify(locations)},
    "seniorityLevelIds": [],
    "yearsOfExperienceIds": [],
    "schools": [],
    "profileLanguages": ["English"],
    "profileScraperMode": "Full",
    "maxItems": 100
  }
}

CRITICAL REMINDERS:
- ALWAYS set currentCompanies: [], pastCompanies: [], pastJobTitles: [], schools: [] (empty) in ALL tiers
- Tier 1 MUST have: niche searchQuery, 3-5 skills, experience IDs, seniority IDs
- Tier 2: Loosen by ~30% (broader niche, fewer skills, wider ranges)
- Tier 3: Loosen by ~60% (generic keywords, no skills/seniority/experience)
- Extract niche from headline/bio/skills (e.g., "SaaS", "fintech", "healthcare tech")
- Use specific sub-industry exclusions, not broad categories

Return ONLY valid JSON.`;

return [{
  json: {
    prompt,
    session_id: session.session_id,
    profile_name,
    industries,
    industry_ids: industryIds,
    locations,
    company_size,
    hiring_intensity,
    persona_description,
    lookalike,
    primary_industry: primaryIndustry
  }
}];
'''

def optimize_workflow_v4():
    print(f"Reading from {INPUT_PATH}...")
    with open(INPUT_PATH, 'r') as f:
        data = json.load(f)

    nodes = data.get('nodes', [])
    print(f"Found {len(nodes)} nodes.")

    # Update Prepare Strategy Context with v4 prompt
    for node in nodes:
        if node.get('name') == 'Prepare Strategy Context' and node.get('type') == 'n8n-nodes-base.code':
            print("Updating 'Prepare Strategy Context' with v4 tier degradation logic...")
            node['parameters']['jsCode'] = create_optimized_prompt_v4()
            break

    # Save final workflow
    print(f"Saving v4 workflow to {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(data, f, indent=2)

    print("\n✅ SUCCESS! v4 workflow with tier degradation logic complete.")
    print(f"\n📦 File: '{OUTPUT_PATH}'")
    print("\n🎯 KEY IMPROVEMENTS:")
    print("   1. Company filters ALWAYS empty (currentCompanies, pastCompanies)")
    print("   2. Explicit tier degradation rules (30% → 60% loosening)")
    print("   3. Clear examples for each tier")
    print("   4. Tier 1: Maximum precision (70-100% target)")
    print("   5. Tier 2: Expanded reach (only if Tier 1 < 80%)")
    print("   6. Tier 3: Safety net (only if Tier 1+2 < 85%)")

if __name__ == '__main__':
    optimize_workflow_v4()
