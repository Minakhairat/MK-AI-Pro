#!/usr/bin/env node
import { execSync } from 'node:child_process';

const env = {
  ...process.env,
  ELECTRON_BUILD: 'true',
  VITE_BASE_PATH: './',
};

execSync('npx vite build', { stdio: 'inherit', env });
execSync('npm run build:electron', { stdio: 'inherit', env });
