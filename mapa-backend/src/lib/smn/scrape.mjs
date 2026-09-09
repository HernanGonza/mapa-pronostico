import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const script = fileURLToPath(new URL('../../../../opensmn/scrape_smn.py', import.meta.url));
const python = process.env.SMN_SCRAPE_PYTHON || path.resolve(path.dirname(script), '.venv/bin/python');

export function consultarPagina(url = process.env.SMN_SCRAPE_URL || 'https://www.smn.gob.ar/alertas', timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('SMN scraping: timeout')); }, timeoutMs);
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 2_000_000) { child.kill('SIGTERM'); reject(new Error('SMN scraping: respuesta demasiado grande')); } });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`SMN scraping: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`SMN scraping: proceso terminó con ${code}${err ? ` · ${err.trim().slice(-300)}` : ''}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('SMN scraping: salida JSON inválida')); }
    });
  });
}
