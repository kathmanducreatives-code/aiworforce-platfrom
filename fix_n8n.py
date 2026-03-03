import json

file_path = 'Outreach - Batch Scrape + DM Generator.json'

with open(file_path, 'r') as f:
    data = json.load(f)

# Create the new Node
new_node = {
    "parameters": {
        "mode": "runOnceForAllItems",
        "jsCode": "const payload = $input.first().json;\nconst items = payload.body?.leads || payload.leads || [];\nreturn items.map(lead => ({ json: lead }));"
    },
    "id": "extract-leads-from-webhook",
    "name": "Extract Webhook Leads",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [
        80, 
        160
    ]
}

data['nodes'].append(new_node)

# Update Webhook connections 
if 'Webhook' in data['connections']:
    data['connections']['Webhook'] = {
        "main": [
            [
                {
                    "node": "Extract Webhook Leads",
                    "type": "main",
                    "index": 0
                }
            ]
        ]
    }

# Ensure Extract Webhook Leads connects to Split In Batches
data['connections']['Extract Webhook Leads'] = {
    "main": [
        [
            {
                "node": "Split In Batches",
                "type": "main",
                "index": 0
            }
        ]
    ]
}

with open(file_path, 'w') as f:
    json.dump(data, f, indent=2)

print("JSON successfully modified")
