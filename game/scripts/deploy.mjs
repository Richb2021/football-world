import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');

const FTP_USER = process.env.FTP_USER ?? 'richardbatt.com';
const FTP_PASS = process.env.FTP_PASS;
const FTP_HOST = process.env.FTP_HOST ?? 'ftp.gb.stackcp.com';
const FTP_DIR = process.env.FTP_DIR ?? 'public_html/international-cup';
const CONCURRENCY = Math.max(1, Number(process.env.DEPLOY_CONCURRENCY ?? 4));
const MAX_RETRIES = Math.max(1, Number(process.env.DEPLOY_RETRIES ?? 6));
const SKIP_COMMENTARY_AUDIO = process.env.DEPLOY_SKIP_COMMENTARY_AUDIO === '1';

if (!FTP_PASS) {
  console.error('Missing FTP_PASS environment variable.');
  process.exit(1);
}

function getFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries.filter(file => !file.isDirectory()).map(file => path.join(dir, file.name));
  const folders = entries.filter(file => file.isDirectory());
  for (const folder of folders) {
    files.push(...getFiles(path.join(dir, folder.name)));
  }
  return files;
}

if (!fs.existsSync(DIST_DIR)) {
  console.error(`Dist directory does not exist: ${DIST_DIR}. Run npm run build first.`);
  process.exit(1);
}

console.log("Scanning dist directory...");
const allFiles = getFiles(DIST_DIR).filter(file => {
  if (file.includes('.DS_Store')) return false;
  if (!SKIP_COMMENTARY_AUDIO) return true;
  const relativePath = path.relative(DIST_DIR, file).replaceAll(path.sep, '/');
  return !relativePath.startsWith('assets/commentary/') || !/\.(mp3|wav|ogg)$/i.test(relativePath);
});
const totalFiles = allFiles.length;
console.log(`Found ${totalFiles} files to upload.`);

let currentIndex = 0;
let successCount = 0;
let failCount = 0;

function runUploadWithRetry(file, relativePath, attempt = 1) {
  return new Promise((resolve) => {
    // URL-encode the path segments to handle spaces and special characters
    const encodedPath = relativePath.split(/[/\\]/).map(encodeURIComponent).join('/');
    const targetUrl = `ftp://${FTP_HOST}/${FTP_DIR}/${encodedPath}`;

    execFile('curl', [
      '-sS',
      '--connect-timeout',
      '20',
      '--max-time',
      '120',
      '--ftp-create-dirs',
      '-T',
      file,
      targetUrl,
      '--user',
      `${FTP_USER}:${FTP_PASS}`,
    ], async (err, stdout, stderr) => {
      if (err) {
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(30000, 2500 * attempt);
          await new Promise(r => setTimeout(r, delay));
          resolve(runUploadWithRetry(file, relativePath, attempt + 1));
        } else {
          console.error(`[FAIL] ${relativePath}: ${stderr.trim() || err.message}`);
          failCount++;
          resolve();
        }
      } else {
        successCount++;
        if (successCount % 100 === 0 || successCount === totalFiles) {
          console.log(`Progress: Uploaded ${successCount}/${totalFiles} files (Errors: ${failCount})...`);
        }
        resolve();
      }
    });
  });
}

async function worker() {
  while (currentIndex < totalFiles) {
    const index = currentIndex++;
    if (index >= totalFiles) break;
    const file = allFiles[index];
    const relativePath = path.relative(DIST_DIR, file);
    await runUploadWithRetry(file, relativePath);
  }
}

console.log(`Starting deployment with concurrency of ${CONCURRENCY}...`);
const workers = Array.from({ length: CONCURRENCY }, () => worker());
await Promise.all(workers);

console.log(`Deployment complete! Success: ${successCount}, Failed: ${failCount}`);
