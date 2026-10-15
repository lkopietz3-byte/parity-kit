// Writes the reason phrases of this Node runtime (http.STATUS_CODES) as JSON: node extract-local.mjs <out.json>
import { STATUS_CODES } from 'node:http';
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], `${JSON.stringify({ node: process.version, codes: STATUS_CODES }, null, 1)}\n`);
