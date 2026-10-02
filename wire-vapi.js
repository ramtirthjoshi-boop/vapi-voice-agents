// Renames the assistants off their build-order names and wires each one to the
// call log: an end-of-call webhook, plus the analysis plan that makes Vapi
// return the outcome as structured data instead of leaving it in the transcript.
//
//   PowerShell:
//     $env:VAPI_API_KEY   = Read-Host "Paste Vapi private key"
//     $env:N8N_WEBHOOK_URL = Read-Host "Paste n8n webhook URL"
//     node wire-vapi.js
//
// Neither value is stored in this file. The webhook URL in particular stays out
// of version control: the endpoint takes unauthenticated POSTs, so publishing
// its address would let anyone write rows into the log.

function clean(raw) {
  return (raw || '').trim().replace(/^['"<]+|['">]+$/g, '').trim();
}

const KEY = clean(process.env.VAPI_API_KEY);
const HOOK = clean(process.env.N8N_WEBHOOK_URL);
const BASE = 'https://api.vapi.ai';

if (!KEY || !HOOK) {
  console.error('Both VAPI_API_KEY and N8N_WEBHOOK_URL must be set. In PowerShell:');
  console.error('  $env:VAPI_API_KEY = Read-Host "Paste Vapi private key"');
  console.error('  $env:N8N_WEBHOOK_URL = Read-Host "Paste n8n webhook URL"');
  console.error('  node wire-vapi.js');
  process.exit(1);
}

// Enough to spot a mangled paste, not enough to reconstruct the key.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
console.log(`key: ${KEY.length} chars, uuid-shaped: ${uuid.test(KEY)}`);
console.log(`hook: ${HOOK}`);
if (!HOOK.startsWith('https://')) {
  console.log('  ! Vapi will not call a plain-http URL — this needs to be https');
}

// A shared secret, so the webhook can tell a real Vapi callback from anyone who
// happens to find the URL. Vapi sends it back as the x-vapi-secret header.
const SECRET = require('crypto').randomBytes(24).toString('hex');

// Keyed on the current name. Build-order names ("Lesson 4") say nothing about
// what an assistant does; these say the role and which iteration it is.
const RENAMES = {
  'Jack - Lesson 1': 'Jack - Decision Maker (v1)',
  'Jack - Lesson 2': 'Jack - Decision Maker (v2)',
  'Sarah - Lesson 3 - 2': 'Sarah - Gatekeeper',
  'Sarah - Lesson 4 - Squad': 'Sarah - Gatekeeper (squad)',
  'Jack - Lesson 4 - Squad': 'Jack - Decision Maker (squad)',
};

// The outcome set the prompts already define. Declaring it here is what moves
// the outcome out of the transcript and into a field that can be counted.
const ANALYSIS_PLAN = {
  summaryPlan: { enabled: true },
  structuredDataPlan: {
    enabled: true,
    schema: {
      type: 'object',
      properties: {
        outcome: {
          type: 'string',
          enum: ['Booked', 'Callback', 'Dead'],
          description:
            'Booked only if a date and time were actually agreed. Callback if the ' +
            'prospect asked to be contacted again without agreeing a time. Dead if ' +
            'the prospect ended the conversation.',
        },
        reason: {
          type: 'string',
          description:
            'One sentence on what decided it — the specific thing the caller said ' +
            'or failed to say. Quote the call, do not generalise.',
        },
      },
      required: ['outcome'],
    },
  },
};

(async () => {
  let res;
  try {
    res = await fetch(`${BASE}/assistant`, { headers: { Authorization: `Bearer ${KEY}` } });
  } catch (err) {
    console.error(`\nCould not reach ${BASE} — ${err.message}`);
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`\nGET /assistant failed: HTTP ${res.status} ${res.statusText}`);
    if (body) console.error(`server said: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const list = await res.json();
  const assistants = Array.isArray(list) ? list : list.data || [];
  console.log(`\nfound ${assistants.length} assistant(s)\n`);

  let ok = 0;
  let failed = 0;

  for (const a of assistants) {
    const current = (a.name || '').trim();
    const renamed = RENAMES[current];
    const label = renamed ? `${current}  ->  ${renamed}` : `${current}  (name unchanged)`;

    const patch = {
      server: { url: HOOK, secret: SECRET, timeoutSeconds: 20 },
      serverMessages: ['end-of-call-report'],
      analysisPlan: ANALYSIS_PLAN,
    };
    if (renamed) patch.name = renamed;

    let pr;
    try {
      pr = await fetch(`${BASE}/assistant/${a.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.log(`  FAIL  ${label}\n        ${err.message}`);
      failed++;
      continue;
    }

    if (pr.ok) {
      console.log(`  ok    ${label}`);
      ok++;
    } else {
      const body = await pr.text().catch(() => '');
      console.log(`  FAIL  ${label}`);
      console.log(`        HTTP ${pr.status} ${pr.statusText} ${body.slice(0, 200)}`);
      failed++;
    }
  }

  console.log(`\n${ok} updated, ${failed} failed`);

  if (ok > 0) {
    console.log('\nWebhook secret for the n8n side (paste this back, then re-run export-vapi.js):');
    console.log(`  ${SECRET}`);
    console.log('\nIt is already set on Vapi. Until the n8n Code node is given the same');
    console.log('value the webhook accepts any caller, which is the current behaviour anyway.');
  }
})();
