import json
import os

INPUT_PATH = './icp_lookalike_engine_v2.json'
OUTPUT_PATH = 'icp_lookalike_engine_v3.json'

def create_optimized_prompt():
    """Generate the new tier-aware AI prompt"""
    return '''// ============================================================
// TIER-AWARE STRATEGY CONTEXT BUILDER
// Extracts precise signals for high-precision Tier 1 results
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
// NEW: TIER-AWARE AI PROMPT
// ============================================================
const prompt = `You are a LinkedIn talent search strategist. Your goal is to generate TIER-SPECIFIC search parameters that maximize Tier 1 precision.

CRITICAL CONTEXT:
The system uses a 3-tier waterfall search:
- **Tier 1 (HIGH PRECISION)**: Should deliver 70-100% of target results with excellent quality
- **Tier 2 (EXPANDED REACH)**: Fallback if Tier 1 is insufficient (relaxed filters)
- **Tier 3 (SAFETY VALVE)**: Emergency fallback (very broad filters)

YOUR PRIMARY GOAL: Make Tier 1 so precise that it delivers 70-100 high-quality matches, minimizing reliance on Tier 2/3.

PROFILE ANALYSIS:
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

TIER 1 EXTRACTION RULES (CRITICAL FOR PRECISION):

1. NICHE SPECIALIZATION (MANDATORY):
   - Extract the EXACT niche from headline, bio, and skills
   - If headline contains "B2B SaaS recruiting" → searchQuery MUST include "B2B SaaS recruiting" OR "SaaS talent acquisition" OR "tech recruiting"
   - If skills contain ["SaaS", "SaaS Sales"] → These are NICHE indicators, not generic
   - Rule: If profile mentions a specific niche (SaaS, fintech, healthcare tech, e-commerce, etc.), Tier 1 searchQuery MUST include that niche as quoted phrases or specific variations
   - BAD Tier 1 query: "(CEO OR Founder) AND (recruiting OR staffing)" ← TOO GENERIC
   - GOOD Tier 1 query: "(CEO OR Founder) AND (\\"B2B SaaS recruiting\\" OR \\"SaaS talent\\" OR \\"tech executive search\\") AND (scale-up OR unicorn) -\\"healthcare staffing\\" -\\"retail recruiting\\""

2. EXPERIENCE LEVEL FILTERING (MANDATORY):
   - Profile years: ${lookalike.years_experience}
   - Map to LinkedIn experience IDs (ALWAYS REQUIRED FOR TIER 1):
     * 0-2 years → ID "1"
     * 3-5 years → ID "2"
     * 6-10 years → ID "3"
     * 11-15 years → ID "4"
     * 16-20 years → ID "5"
     * 21+ years → ID "6"
   - Tier 1 tolerance: ±5 years (e.g., 18 years → search 11-20 years → IDs ["4", "5"])
   - Tier 2 tolerance: ±8 years
   - Tier 3 tolerance: Any 5+ years
   - NEVER leave yearsOfExperienceIds empty in Tier 1

3. SKILLS AS DIFFERENTIATORS (MANDATORY):
   - Extract top 3-5 NICHE-SPECIFIC skills from profile
   - Profile skills: ${lookalike.skills.slice(0, 10).join(', ')}
   - Tier 1: Require 3-4 of these skills (separates specialists from generalists)
   - Tier 2: Require 1-2 skills
   - Tier 3: No skill requirements
   - NEVER leave skills empty in Tier 1

4. SENIORITY MATCHING (MANDATORY):
   - Profile seniority: ${lookalike.seniority_level}
   - Map to LinkedIn seniority IDs:
     * Entry/Junior (100-110): Internship, Entry Level
     * Mid-level (120-130): Associate, Mid-Senior
     * Manager (200-220): Manager, Senior Manager
     * Executive (300-320): Director, VP, C-level
   - Tier 1: Exact seniority match (e.g., Executive → ["300", "310", "320"])
   - Tier 2: Allow one level down (e.g., Executive → ["220", "300", "310", "320"])
   - Tier 3: Broader range
   - NEVER leave seniorityLevelIds empty in Tier 1

5. TIER-SPECIFIC SEARCH QUERY CONSTRUCTION:
   - Tier 1 formula: (specific_title1 OR specific_title2) AND ("exact niche phrase" OR niche_variant1 OR niche_variant2) AND (qualifier1 OR qualifier2) -"specific_wrong_subniche1" -"specific_wrong_subniche2"
   - Tier 2 formula: (title_variants) AND (niche_category OR related_keyword) -broad_wrong_industry
   - Tier 3 formula: (generic_title) AND (industry_keyword) -clearly_unrelated
   
   Example for B2B SaaS recruiting CEO:
   - Tier 1: (CEO OR Founder OR "Managing Partner") AND ("B2B SaaS recruiting" OR "SaaS talent acquisition" OR "tech executive search") AND (scale-up OR unicorn OR "Series A") -"healthcare staffing" -"retail recruiting" -"hospitality staffing" -"temporary staffing"
   - Tier 2: (CEO OR Founder OR "VP Talent") AND (SaaS OR software OR technology) AND recruiting -healthcare -retail -hospitality
   - Tier 3: (CEO OR Founder OR Owner) AND (recruiting OR staffing) -healthcare -retail

6. NEGATIVE KEYWORDS (BE SPECIFIC):
   - Tier 1: Exclude specific WRONG SUB-INDUSTRIES (not broad categories)
     * For SaaS recruiters: -"healthcare staffing" -"retail recruiting" -"hospitality staffing" -"temporary staffing"
     * For fintech: -"traditional banking" -"wealth management" (NOT just "-finance")
     * For legaltech: -"law firm" -"litigation" (NOT just "-legal")
   - Tier 2: Broaden slightly: -healthcare -retail -hospitality
   - Tier 3: Only clearly unrelated: -nonprofit -government

7. INDUSTRY FILTERING:
   - Tier 1: Strict - only exact industry (e.g., "104" for Staffing & Recruiting)
   - Tier 2: Add adjacent industries (e.g., add "96" IT Services for tech recruiters)
   - Tier 3: Accept any related industry

OUTPUT FORMAT (JSON only, no markdown):
{
  "role_family": "<recruiting|engineering|sales|marketing|finance|operations|legal|healthcare|design|product|data|hr|executive|consulting|other>",
  "primary_industry": "<THE MAIN INDUSTRY>",
  "niche_specialization": "<EXTRACTED NICHE e.g. 'B2B SaaS recruiting', 'fintech sales', 'healthcare tech'>",
  "mandatory_signals": {
    "job_titles": ["<3-5 core titles>"],
    "keywords": ["<5-8 niche-specific keywords>"],
    "industries": ["<industry IDs>"]
  },
  "supportive_signals": {
    "skills": ["<3-5 differentiating skills for Tier 1>"],
    "past_companies": [],
    "certifications": []
  },
  "excluded": {
    "role_families": ["<role families to exclude>"],
    "industries": ["<industry NAMES>"],
    "keywords": ["<specific sub-industry keywords to exclude>"]
  },
  "generated_strategy": "<1-2 sentence explanation>",
  "search_logic_dna": "<technical summary>",
  "tier_1_params": {
    "searchQuery": "<PRECISE query with niche phrases>",
    "currentJobTitles": [],
    "pastJobTitles": [],
    "currentCompanies": [],
    "pastCompanies": [],
    "skills": ["<3-4 required skills>"],
    "industryIds": ["<1-2 exact IDs>"],
    "locations": ${JSON.stringify(locations)},
    "seniorityLevelIds": ["<exact seniority IDs>"],
    "yearsOfExperienceIds": ["<experience IDs with ±5 year tolerance>"],
    "schools": [],
    "profileLanguages": ["English"],
    "profileScraperMode": "Full",
    "maxItems": 100
  },
  "tier_2_params": {
    "searchQuery": "<EXPANDED query>",
    "currentJobTitles": [],
    "skills": ["<1-2 skills>"],
    "industryIds": ["<2-3 IDs including adjacent>"],
    "locations": ${JSON.stringify(locations)},
    "seniorityLevelIds": ["<expanded seniority range>"],
    "yearsOfExperienceIds": ["<±8 year tolerance>"],
    "profileLanguages": ["English"],
    "profileScraperMode": "Full",
    "maxItems": 100
  },
  "tier_3_params": {
    "searchQuery": "<BROAD query>",
    "currentJobTitles": [],
    "skills": [],
    "industryIds": ["<broad industry IDs>"],
    "locations": ${JSON.stringify(locations)},
    "seniorityLevelIds": [],
    "yearsOfExperienceIds": [],
    "profileLanguages": ["English"],
    "profileScraperMode": "Full",
    "maxItems": 100
  }
}

CRITICAL REMINDERS:
- Tier 1 MUST have: niche-specific searchQuery, 3-4 skills, experience IDs, seniority IDs
- NEVER leave Tier 1 filters empty
- Extract niche from headline/bio/skills (e.g., "SaaS", "fintech", "healthcare tech")
- Use specific sub-industry exclusions, not broad categories
- The better Tier 1 performs, the less we need Tier 2/3

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

def optimize_workflow():
    print(f"Reading from {INPUT_PATH}...")
    try:
        with open(INPUT_PATH, 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Error: Input file not found.")
        return
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON: {e}")
        return

    nodes = data.get('nodes', [])
    print(f"Found {len(nodes)} nodes in workflow '{data.get('name')}'.")

    # Find and update the "Prepare Strategy Context" node
    context_node_found = False
    for node in nodes:
        if node.get('name') == 'Prepare Strategy Context' and node.get('type') == 'n8n-nodes-base.code':
            print("Updating 'Prepare Strategy Context' node with tier-aware prompt...")
            node['parameters']['jsCode'] = create_optimized_prompt()
            context_node_found = True
            break
    
    if not context_node_found:
        print("Warning: Could not find 'Prepare Strategy Context' node.")
        return

    # Update the "Parse AI Output" node to handle tier-specific structure
    parse_node_found = False
    for node in nodes:
        if node.get('name') == 'Parse AI Output' and node.get('type') == 'n8n-nodes-base.code':
            print("Updating 'Parse AI Output' node to handle tier-specific params...")
            # The new prompt returns tier_1_params, tier_2_params, tier_3_params
            # We need to store these separately and use them in Build Tier X nodes
            new_parse_code = '''// LAYER 1-2: Parse AI Output with Tier-Specific Signal Extraction
const aiNode = $('AI Strategy Generation').first();
const aiText = aiNode.json.text || aiNode.json.output || '';
const context = $('Prepare Strategy Context').first().json;

// Default structure with SAFE DEFAULTS (Layer 7)
let parsed = {
  role_family: 'other',
  niche_specialization: '',
  mandatory_signals: {
    job_titles: [],
    keywords: [],
    industries: []
  },
  supportive_signals: {
    skills: [],
    past_companies: [],
    certifications: []
  },
  excluded: {
    role_families: [],
    industries: ['Arts', 'Music', 'Entertainment', 'Non-profit', 'Religious', 'Wildlife', 'Conservation'],
    keywords: []
  },
  generated_strategy: '',
  search_logic_dna: '',
  tier_1_params: null,
  tier_2_params: null,
  tier_3_params: null
};

try {
  // Parse JSON from AI response
  const jsonStr = aiText.replace(/```json\\n?/g, '').replace(/```\\n?/g, '').trim();
  const aiParsed = JSON.parse(jsonStr);
  
  // Extract role_family and niche
  parsed.role_family = aiParsed.role_family || 'other';
  parsed.niche_specialization = aiParsed.niche_specialization || '';
  
  // Extract mandatory_signals
  if (aiParsed.mandatory_signals) {
    parsed.mandatory_signals = {
      job_titles: aiParsed.mandatory_signals.job_titles || [],
      keywords: aiParsed.mandatory_signals.keywords || [],
      industries: aiParsed.mandatory_signals.industries || []
    };
  }
  
  // Extract supportive_signals
  if (aiParsed.supportive_signals) {
    parsed.supportive_signals = {
      skills: aiParsed.supportive_signals.skills || [],
      past_companies: aiParsed.supportive_signals.past_companies || [],
      certifications: aiParsed.supportive_signals.certifications || []
    };
  }
  
  // Extract excluded signals
  if (aiParsed.excluded) {
    parsed.excluded = {
      role_families: aiParsed.excluded.role_families || [],
      industries: [...new Set([...(aiParsed.excluded.industries || []), 'Arts', 'Music', 'Entertainment', 'Non-profit', 'Religious', 'Wildlife', 'Conservation'])],
      keywords: aiParsed.excluded.keywords || []
    };
  }
  
  // Extract strategy explanations
  parsed.generated_strategy = aiParsed.generated_strategy || '';
  parsed.search_logic_dna = aiParsed.search_logic_dna || '';
  
  // Extract tier-specific params
  parsed.tier_1_params = aiParsed.tier_1_params || null;
  parsed.tier_2_params = aiParsed.tier_2_params || null;
  parsed.tier_3_params = aiParsed.tier_3_params || null;
  
} catch (error) {
  console.error('Failed to parse AI output:', error.message);
}

// LAYER 7: SAFE DEFAULTS - Validate tier params exist
if (!parsed.tier_1_params) {
  console.warn('No tier_1_params from AI, generating fallback');
  const fallbackKeywords = parsed.mandatory_signals.keywords.slice(0, 5).join(' ');
  parsed.tier_1_params = {
    searchQuery: fallbackKeywords || `${parsed.role_family} professional`,
    currentJobTitles: [],
    skills: parsed.supportive_signals.skills.slice(0, 4),
    industryIds: context.industry_ids || [],
    locations: context.locations || [],
    seniorityLevelIds: [],
    yearsOfExperienceIds: [],
    profileLanguages: ['English'],
    profileScraperMode: 'Full',
    maxItems: 100
  };
}

return [{
  json: {
    role_family: parsed.role_family,
    niche_specialization: parsed.niche_specialization,
    mandatory_signals: parsed.mandatory_signals,
    supportive_signals: parsed.supportive_signals,
    excluded: parsed.excluded,
    generated_strategy: parsed.generated_strategy,
    search_logic_dna: parsed.search_logic_dna,
    tier_1_params: parsed.tier_1_params,
    tier_2_params: parsed.tier_2_params,
    tier_3_params: parsed.tier_3_params,
    // Keep legacy apify_params for backward compatibility (use tier_1)
    apify_params: parsed.tier_1_params
  }
}];'''
            node['parameters']['jsCode'] = new_parse_code
            parse_node_found = True
            break
    
    if not parse_node_found:
        print("Warning: Could not find 'Parse AI Output' node.")

    # Save optimized workflow
    print(f"Saving optimized workflow to {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(data, f, indent=2)

    print("Success! Import 'icp_lookalike_engine_v3.json' into n8n.")
    print("\nKEY CHANGES:")
    print("1. AI now extracts niche specialization from headline/bio/skills")
    print("2. Tier 1 ALWAYS includes: experience IDs, seniority IDs, 3-4 skills")
    print("3. Tier-specific search queries (precise → expanded → broad)")
    print("4. Specific sub-industry exclusions instead of broad categories")

if __name__ == '__main__':
    optimize_workflow()
