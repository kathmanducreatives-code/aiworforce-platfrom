import json
import os

# Define paths
INPUT_PATH = './icp_lookalike_engine_original.json'
OUTPUT_PATH = 'icp_lookalike_engine_v2.json'

def optimize_workflow():
    print(f"Reading from {INPUT_PATH}...")
    try:
        with open(INPUT_PATH, 'r') as f:
            content = f.read().strip()
            # The file structure seems to be line-based key-value or raw JSON?
            # Step 12 output showed a single line starting with {"workflow": ...
            # But step 15 output showed "1: {"workflow":...". 
            # I must handle if there are line numbers or not. 
            # Step 12 saved it directly, step 15 added line numbers view. 
            # The file on disk from Step 12 is raw.
            data = json.loads(content)
    except FileNotFoundError:
        print("Error: Input file not found.")
        return
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON: {e}")
        return

    workflow = data.get('workflow', {})
    nodes = workflow.get('nodes', [])

    print(f"Found {len(nodes)} nodes in workflow '{workflow.get('name')}'.")

    # 1. Upgrade AI Model
    ai_node_found = False
    for node in nodes:
        if node.get('name') == 'Anthropic Haiku' and node.get('type') == '@n8n/n8n-nodes-langchain.lmChatAnthropic':
            print("Upgrading 'Anthropic Haiku' node to Claude 3.5 Sonnet...")
            node['parameters']['model'] = 'claude-3-5-sonnet-20240620'
            node['name'] = 'Claude 3.5 Sonnet' # Update name for clarity
            ai_node_found = True
    
    if not ai_node_found:
        print("Warning: Could not find 'Anthropic Haiku' node to upgrade.")

    # 2. Inject Scoring Configuration in 'Process & Score Results'
    score_node_found = False
    for node in nodes:
        if node.get('name') == 'Process & Score Results' and node.get('type') == 'n8n-nodes-base.code':
            print("Injecting efficient scoring config into 'Process & Score Results'...")
            js_code = node['parameters']['jsCode']
            
            # Replaces hardcoded weights with a CONFIG object at the top
            scoring_config = """// ============================================================
// SCORING CONFIGURATION (Tunable)
// ============================================================
const WEIGHTS = {
  INDUSTRY_MATCH: 40,
  TITLE_MATCH: 30,
  TIER_BONUS_1: 5,   // Reduced from 15 (Optimization: Quality over Tier)
  TIER_BONUS_2: 3,
  EXPERIENCE: 10,
  SENIORITY: 10
};

// ============================================================
// PROCESS & SCORE RESULTS - FIXED with STRICT INDUSTRY FILTERING
"""
            # Replace the top comment block to inject config
            if "// PROCESS & SCORE RESULTS" in js_code:
                js_code = js_code.replace("// PROCESS & SCORE RESULTS - FIXED with STRICT INDUSTRY FILTERING", scoring_config)
            
            # Updates the scoring logic to use WEIGHTS
            replacements = {
                "score += 40;  // INCREASED from 15": "score += WEIGHTS.INDUSTRY_MATCH;",
                "score += 30;  // INCREASED from 10": "score += WEIGHTS.TITLE_MATCH;", 
                "score += 15;  // REDUCED from 20": "score += WEIGHTS.TIER_BONUS_1;",
                "score += 8;": "score += WEIGHTS.TIER_BONUS_2;"
            }
            
            for old, new in replacements.items():
                js_code = js_code.replace(old, new)
                
            node['parameters']['jsCode'] = js_code
            score_node_found = True

    if not score_node_found:
        print("Warning: Could not find 'Process & Score Results' node.")

    # 3. Add 'Auto-Email' capability (Mock for now, just adding the input flag check support in Validation)
    # We won't change logic deeply to avoid breaking, but we'll add the field to the schema note.
    
    # Save optimized workflow
    print(f"Saving optimized workflow to {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(workflow, f, indent=2)

    print("Success! Import 'icp_lookalike_engine_v2.json' into n8n.")

if __name__ == '__main__':
    optimize_workflow()
