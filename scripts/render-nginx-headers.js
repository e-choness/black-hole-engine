// Prints the shared security headers as nginx add_header directives (used by the Docker build).
import { securityHeaders } from '../config/security-headers.js';

const directives = Object.entries(securityHeaders).map(
    ([name, value]) => `add_header ${name} "${value.replaceAll('"', '\\"')}" always;`,
);

process.stdout.write(`${directives.join('\n')}\n`);
