#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const versionsPath = path.join(rootDir, 'ai_engine', 'manifests', 'versions.json');
const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));

const pythonBundleDir = path.join(rootDir, 'build', 'python-bundle');
const wheelhouseDir = path.join(rootDir, 'build', 'wheelhouse');
const offlineMode = process.argv.includes('--offline') || process.env.OFFLINE_INSTALLER === '1';

fs.mkdirSync(pythonBundleDir, { recursive: true });
fs.mkdirSync(wheelhouseDir, { recursive: true });

async function downloadFile(url, dest, options = {}) {
  console.log(`Downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed downloading ${url}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (options.minBytes && buf.length < options.minBytes) {
    throw new Error(`Downloaded ${url} is unexpectedly small (${buf.length} bytes).`);
  }
  if (options.expectedMagic && !buf.subarray(0, options.expectedMagic.length).equals(options.expectedMagic)) {
    throw new Error(`Downloaded ${url} failed magic header verification.`);
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  if (options.expectedSha256 && sha256.toLowerCase() !== options.expectedSha256.toLowerCase()) {
    throw new Error(`SHA-256 verification failed for ${url}: got ${sha256}`);
  }
  fs.writeFileSync(dest, buf);
  console.log(`Verified ${path.basename(dest)} (${buf.length} bytes, sha256:${sha256.slice(0, 12)})`);
}

async function main() {
  const pyZipUrl = versions.pythonEmbeddable.downloadUrl;
  const getPipUrl = versions.pythonEmbeddable.getPipUrl;
  const zipPath = path.join(pythonBundleDir, 'python-embed.zip');
  const getPipPath = path.join(pythonBundleDir, 'get-pip.py');

  if (!offlineMode && fs.existsSync(wheelhouseDir)) {
    fs.rmSync(wheelhouseDir, { recursive: true, force: true });
    fs.mkdirSync(wheelhouseDir, { recursive: true });
  }

  const pyExe = path.join(pythonBundleDir, 'python.exe');
  const alreadyExtractedWin = process.platform === 'win32' && fs.existsSync(pyExe);

  if (!alreadyExtractedWin) {
    await downloadFile(pyZipUrl, zipPath, {
      minBytes: 5 * 1024 * 1024,
      expectedMagic: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      expectedSha256: versions.pythonEmbeddable.sha256,
    });
    await downloadFile(getPipUrl, getPipPath, {
      minBytes: 100 * 1024,
    });
  }

  if (process.platform === 'win32') {
    if (!alreadyExtractedWin) {
      console.log('Extracting Windows embeddable Python...');
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${pythonBundleDir.replace(/'/g, "''")}' -Force`,
        ],
        { stdio: 'inherit' }
      );
      fs.rmSync(zipPath, { force: true });

      // Enable site-packages in ._pth
      for (const entry of fs.readdirSync(pythonBundleDir)) {
        if (entry.endsWith('._pth')) {
          const pth = path.join(pythonBundleDir, entry);
          const content = fs.readFileSync(pth, 'utf8');
          fs.writeFileSync(pth, content.replace(/^#\s*import site/m, 'import site'), 'utf8');
        }
      }

      if (!fs.existsSync(pyExe)) {
        throw new Error('python.exe missing after extracting Windows embeddable archive.');
      }
      execFileSync(pyExe, [getPipPath, '--no-warn-script-location'], { stdio: 'inherit' });
    }

    if (offlineMode) {
      console.log('Downloading offline CPU wheelhouse for bundled installer...');
      const reqCpu = path.join(rootDir, 'ai_engine', 'manifests', 'requirements-cpu.txt');
      execFileSync(
        pyExe,
        ['-m', 'pip', 'download', '-r', reqCpu, '--dest', wheelhouseDir],
        { stdio: 'inherit' }
      );
    }
  } else {
    console.log(
      'Non-Windows host detected: staged verified embeddable archive + get-pip.py inside build/python-bundle.'
    );
  }

  console.log(`Prepared python-bundle (${offlineMode ? 'offline' : 'online'} mode).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
