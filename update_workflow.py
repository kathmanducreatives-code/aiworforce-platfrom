import json
import re

# Load the workflow JSON
with open('workflow_deepsearch.json', 'r') as f:
    data = json.load(f)

# Navigate to nodes list
nodes = []
workflow_data = {}

if 'workflow' in data:
    workflow_data = data['workflow']
    if 'nodes' in workflow_data:
        nodes = workflow_data['nodes']
    elif 'nodes' in data:
        nodes = data['nodes']
else:
    # Assume root is the workflow
    workflow_data = data
    if 'nodes' in data:
        nodes = data['nodes']

# Modify nodes
for node in nodes:
    # 1. Enable Email Scraping in Apify Node
    if node['name'] == 'Run an Actor and get dataset1':
        if 'parameters' in node and 'customBody' in node['parameters']:
            if '"includeEmail": false' in node['parameters']['customBody']:
                node['parameters']['customBody'] = node['parameters']['customBody'].replace('"includeEmail": false', '"includeEmail": true')
                print("Enabled email scraping in Apify node.")

    # 2. Add Email Data to Success Response
    if node['name'] == 'Format Success Response':
        if 'parameters' in node and 'jsCode' in node['parameters']:
            code = node['parameters']['jsCode']
            # Add email field
            replacement = """linkedin_url: apifyData?.basic_info?.profile_url || webhookData.linkedin_url,
      email: apifyData?.contact_info?.has_email ? (apifyData?.contact_info?.email || apifyData?.personal_emails?.[0]) : (apifyData?.personal_emails?.[0] || apifyData?.email || null),
      languages: aiParsedData.languages || [],"""
            
            if "linkedin_url: apifyData?.basic_info?.profile_url || webhookData.linkedin_url," in code and "email:" not in code:
                code = code.replace(
                    "linkedin_url: apifyData?.basic_info?.profile_url || webhookData.linkedin_url,",
                    replacement
                )
                node['parameters']['jsCode'] = code
                print("Added email and languages fields to Format Success Response node.")

    # 3. Update AI Prompt to include Languages
    if node['name'] == 'AI Analysis':
        if 'parameters' in node and 'options' in node['parameters'] and 'systemMessage' in node['parameters']['options']:
            prompt = node['parameters']['options']['systemMessage']
            # Add Languages to output structure
            if "Certifications:" in prompt and "Strengths:" in prompt:
                if "Languages:" not in prompt:
                    prompt = prompt.replace(
                        "Certifications:\n<1–2 line simple summary>\n\nStrengths:",
                        "Certifications:\n<1–2 line simple summary>\n\nLanguages:\n<comma separated list of languages with proficiency if available>\n\nStrengths:"
                    )
                    node['parameters']['options']['systemMessage'] = prompt
                    print("Updated AI Prompt to include Languages.")

    # 4. Update JS Parser to extract Languages
    if node['name'] == 'Code in JavaScript':
        if 'parameters' in node and 'jsCode' in node['parameters']:
            code = node['parameters']['jsCode']
            
            # Initialize array
            if 'let languages = [];' not in code:
                code = code.replace('let ideal_roles = [];', 'let ideal_roles = [];\n  let languages = [];')
            
            # Add parser logic
            parser_logic = """    if (/^Languages:/i.test(trimmed)) {
      currentSection = "languages";
      continue;
    }
    if (/^Strengths:/i.test(trimmed)) {
"""
            if 'if (/^Languages:/i.test(trimmed))' not in code:
                code = code.replace('    if (/^Strengths:/i.test(trimmed)) {', parser_logic)
            
            # Add switch case
            switch_logic = """      case "certifications":
        certifications += (certifications ? " " : "") + trimmed;
        break;
      case "languages":
        const lang = trimmed.replace(/^[-•*]\\s*/, "").trim();
        if (lang) {
            // Split by comma if multiple on one line
            lang.split(',').forEach(l => {
                if(l.trim()) languages.push(l.trim());
            });
        }
        break;
      case "strengths":"""
            if 'case "languages":' not in code:
                code = code.replace('      case "certifications":\n        certifications += (certifications ? " " : "") + trimmed;\n        break;\n      case "strengths":', switch_logic)
            
            # Add to return object
            if 'languages,' not in code:
                code = code.replace('      ideal_roles,\n      fit_score', '      ideal_roles,\n      languages,\n      fit_score')
            
            node['parameters']['jsCode'] = code
            print("Updated JS Parser to extract Languages.")

    # 5. NEW: Update Supabase Node Mapping (Create a row)
    if node['name'] == 'Create a row':
        if 'parameters' in node and 'fieldsUi' in node['parameters'] and 'fieldValues' in node['parameters']['fieldsUi']:
            field_values = node['parameters']['fieldsUi']['fieldValues']
            
            # Check if email is already mapped
            has_email = any(fv.get('fieldId') == 'email' for fv in field_values)
            if not has_email:
                field_values.append({
                    "fieldId": "email",
                    "fieldValue": "={{ $('Run an Actor and get dataset1').item.json.contact_info?.email || $('Run an Actor and get dataset1').item.json.personal_emails?.[0] || $('Run an Actor and get dataset1').item.json.email || '' }}"
                })
                print("Added 'email' mapping to Supabase node.")
            
            # Check if languages is already mapped
            has_languages = any(fv.get('fieldId') == 'languages' for fv in field_values)
            if not has_languages:
                field_values.append({
                    "fieldId": "languages",
                    "fieldValue": "={{ $json.languages }}"
                })
                print("Added 'languages' mapping to Supabase node.")
            
            node['parameters']['fieldsUi']['fieldValues'] = field_values

# Reconstruct the payload for API - STRICT KEYS ONLY (no active, no id)
payload = {
    "name": workflow_data.get('name', 'Deepsearch'),
    "nodes": nodes,
    "connections": workflow_data.get('connections', {}),
    "settings": workflow_data.get('settings', {})
    # 'active' removed as it is read-only
}

# Save the updated JSON
with open('workflow_deepsearch_updated.json', 'w') as f:
    json.dump(payload, f, indent=2)

print("Workflow JSON updated successfully with STRICT API structure (NO ACTIVE).")
