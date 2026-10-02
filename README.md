# Vapi voice agents

Version-controlled export of the Vapi voice-agent configuration: assistants,
squads and tools. Exported through the Vapi API by `export-vapi.js`.

## What's here

| File | Contents |
|---|---|
| `config/assistant.json` | 5 assistants |
| `config/squad.json` | 1 squad |
| `config/tool.json` | 2 tools |
| `config/phone-number.json` | empty — no numbers provisioned |
| `config/workflow.json` | empty — no Vapi-native workflows |
| `config/index.json` | manifest with counts and the export timestamp |

The call flow that drives these agents lives in n8n, not in Vapi — see the
`Vapi Workflow` workflow in the n8n backup repo.

## Re-exporting

```powershell
$env:VAPI_API_KEY = Read-Host "Paste Vapi private key"
node export-vapi.js
```

The script replaces credential-shaped fields with `<SCRUBBED>` before writing,
so this repo holds configuration and prompts but no secrets. Rebind anything
marked `<SCRUBBED>` in the Vapi dashboard after an import.

Field-name scrubbing only catches fields that are *named* like credentials. A
key pasted into some other field, such as a custom header value on a tool,
survives it. Check a fresh export before committing.

## Restoring

There is no bulk import. Re-create each object with a POST to the matching Vapi
endpoint (`/assistant`, `/squad`, `/tool`), oldest dependency first: tools, then
assistants, then the squad that references them. The `id` fields in these files
belong to the old objects and are not reusable.
