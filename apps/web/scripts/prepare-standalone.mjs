import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('.next/standalone/apps/web/.next', { recursive: true });
cpSync('.next/static', '.next/standalone/apps/web/.next/static', { recursive: true, force: true });
cpSync('public', '.next/standalone/apps/web/public', { recursive: true, force: true });
