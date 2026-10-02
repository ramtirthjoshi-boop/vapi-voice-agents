// Exports the Vapi org's assistants, squads, tools, phone numbers and workflows
// to config/*.json, with every credential-shaped field scrubbed.
//
// The API key is read from the environment, never stored in this file:
//   PowerShell:  $env:VAPI_API_KEY='<private key>'; node export-vapi.js

const fs = require('fs');
const path = require('path');

// A pasted key often arrives with a trailing newline, or still wrapped in the
// quotes or angle brackets from the instructions. Any of those produce a
// malformed Authorization header, which Vapi answers with 400 rather than 401.
function clean(raw) {
  return (raw || '').trim().replace(/^['"<]+|['">]+$/g, '').trim();
}

const KEY = clean(process.env.VAPI_API_KEY);

if (!KEY) {
  console.error("VAPI_API_KEY is not set. In PowerShell:\n  $env:VAPI_API_KEY='<private key>'; node export-vapi.js");
  process.exit(1);
}

// Enough to spot a mangled paste or the wrong key type, not enough to rebuild it.
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(KEY);
console.log(`key: ${KEY.length} chars, starts "${KEY.slice(0, 4)}", ends "${KEY.slice(-4)}", uuid-shaped: ${isUuid}`);
if (!isUuid) {
  console.log('  ! a Vapi key is a plain UUID. If this is not uuid-shaped, the wrong key was');
  console.log('    pasted (a public key, or an Anthropic/OpenAI key) or the paste is mangled.');
}

const ENDPOINTS = ['assistant', 'squad', 'tool', 'phone-number', 'workflow'];

// Anything whose key name looks like a credential is replaced rather than removed,
// so the shape of the config still shows that the field was configured.
const SECRET_KEY = /(^|[^a-z])(key|apikey|secret|token|password|credential|credentials|authorization|auth|bearer|privatekey|accesstoken|refreshtoken|clientsecret|sid|accountsid)([^a-z]|$)/i;
const SECRET_VALUE = /^(eyJ[A-Za-z0-9_.-]{10,}|sk-[A-Za-z0-9_-]{12,})$/;

let scrubbed = 0;

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) && typeof v !== 'object') {
        out[k] = '<SCRUBBED>';
        scrubbed++;
      } else if (typeof v === 'string' && SECRET_VALUE.test(v)) {
        out[k] = '<SCRUBBED>';
        scrubbed++;
      } else {
        out[k] = scrub(v);
      }
    }
    return out;
  }
  return value;
}

(async () => {
  const outDir = path.join(__dirname, 'config');
  fs.mkdirSync(outDir, { recursive: true });

  const summary = [];
  let anySuccess = false;

  for (const ep of ENDPOINTS) {
    let res;
    try {
      res = await fetch(`https://api.vapi.ai/${ep}`, {
        headers: { Authorization: `Bearer ${KEY}` },
      });
    } catch (err) {
      console.error(`${ep}: could not reach api.vapi.ai — ${err.message}`);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`${ep}: HTTP ${res.status} ${res.statusText}`);
      if (body) console.error(`  server said: ${body.slice(0, 300)}`);
      continue;
    }

    anySuccess = true;
    const raw = await res.json();
    const items = Array.isArray(raw) ? raw : [raw];
    const cleanItems = scrub(items);
    fs.writeFileSync(path.join(outDir, `${ep}.json`), JSON.stringify(cleanItems, null, 2) + '\n');

    for (const item of cleanItems) {
      summary.push({
        endpoint: ep,
        name: item.name || (item.function && item.function.name) || item.number || '(unnamed)',
        id: item.id,
      });
    }
    console.log(`${ep}: ${items.length}`);
  }

  if (!anySuccess) {
    console.error('\nEvery endpoint failed, so nothing was written. A 400 on all of them');
    console.error('points at the Authorization header, not at permissions — check the key');
    console.error('diagnostics printed above. A 401 would mean the key itself was rejected.');
    process.exit(1);
  }

  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), items: summary }, null, 2) + '\n'
  );

  console.log(`\nScrubbed ${scrubbed} credential-shaped field(s).`);
  console.log('Review config/*.json before committing, in case the scrubber missed something.');
  for (const s of summary) console.log(`  ${s.endpoint.padEnd(13)} ${s.name}`);
})();
