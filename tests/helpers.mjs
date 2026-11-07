// 테스트 공용 도우미: 임시 폴더에 기록을 저장하는 BUILD 서버를 빈 포트로 띄우고 끈다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateKey } from '../extension/lib/util.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXT_DIR = path.join(ROOT, 'extension');

/** 비어 있는 포트 하나 고르기 */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 서버 실행. 실제 기록(server/data/db.json)은 건드리지 않도록 임시 폴더(DATA_DIR)를 쓴다.
 * @param {{demo?: boolean, port?: number, env?: Record<string,string>}} opts
 */
export async function startServer({ demo = false, port, env = {} } = {}) {
  port ||= await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-test-'));
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, DEMO: demo ? '1' : '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url + '/api/health');
      if (r.ok) break;
    } catch {}
    if (i === 49) throw new Error('서버가 뜨지 않았어요\n' + log);
    await sleep(100);
  }
  return {
    url,
    port,
    dataDir,
    async stop() {
      proc.kill();
      await new Promise((r) => proc.once('exit', r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function api(base, p, body) {
  const r = await fetch(base + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

/** 서버와 같은 방식(한국 시간)으로 오늘 날짜 키 */
export const todayKey = (d = new Date()) => dateKey(d);
