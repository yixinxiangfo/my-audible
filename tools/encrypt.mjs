#!/usr/bin/env node
// work/ の MP3(暗号化前)を暗号化して audio/ に置き、episodes.json に再生時間を書き込む。
// 使い方: node tools/encrypt.mjs
// - 合言葉は ~/.config/my-audible/passphrase から読む(画面には出さない)
// - 暗号: PBKDF2-SHA256 で鍵を作り、AES-256-GCM。ファイルは「IV(12バイト)+暗号文+タグ」
//   ブラウザの Web Crypto でそのまま復号できる形にしてある
// - 暗号化済みで、元の MP3 のほうが古ければスキップする
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const PASS_FILE = join(homedir(), ".config", "my-audible", "passphrase");
const CRYPTO_JSON = join(ROOT, "crypto.json");
const EPISODES_JSON = join(ROOT, "episodes.json");
const ITERATIONS = 600000;
const CHECK_TEXT = "my-audible-ok";

if (!existsSync(PASS_FILE)) {
  console.log("合言葉がまだ設定されていません。先に node tools/set-passphrase.mjs を実行してください。");
  process.exit(1);
}
const pass = readFileSync(PASS_FILE, "utf8");

function encrypt(key, data) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([iv, c.update(data), c.final(), c.getAuthTag()]);
}

function decrypt(key, buf) {
  const iv = buf.subarray(0, 12), tag = buf.subarray(buf.length - 16), body = buf.subarray(12, buf.length - 16);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

// 鍵の材料(salt)と、合言葉が合っているかを確かめるための暗号文を用意する
let meta;
if (existsSync(CRYPTO_JSON)) {
  meta = JSON.parse(readFileSync(CRYPTO_JSON, "utf8"));
} else {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(pass, salt, ITERATIONS, 32, "sha256");
  meta = { v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS,
           salt: salt.toString("base64"),
           check: encrypt(key, Buffer.from(CHECK_TEXT)).toString("base64") };
  writeFileSync(CRYPTO_JSON, JSON.stringify(meta, null, 2) + "\n");
  console.log("crypto.json を作りました");
}
const key = pbkdf2Sync(pass, Buffer.from(meta.salt, "base64"), meta.iterations, 32, "sha256");
try {
  if (decrypt(key, Buffer.from(meta.check, "base64")).toString() !== CHECK_TEXT) throw new Error();
} catch {
  console.log("合言葉が、前に暗号化したときのものと違います。止めます。");
  process.exit(1);
}

function durationSec(path) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  return Math.round(parseFloat(out.toString()));
}

const episodes = JSON.parse(readFileSync(EPISODES_JSON, "utf8"));
let done = 0, skipped = 0, missing = 0;
for (const show of episodes.programs) {
  for (const ch of show.chapters) {
    for (const b of ch.blocks) {
      const plain = join(ROOT, "work", show.id, b.id + ".mp3");
      const enc = join(ROOT, b.src);
      if (!existsSync(plain)) { missing++; continue; }
      b.duration = durationSec(plain);
      if (existsSync(enc) && statSync(enc).mtimeMs > statSync(plain).mtimeMs) { skipped++; continue; }
      mkdirSync(dirname(enc), { recursive: true });
      writeFileSync(enc, encrypt(key, readFileSync(plain)));
      console.log("暗号化: " + b.src);
      done++;
    }
  }
}
writeFileSync(EPISODES_JSON, JSON.stringify(episodes, null, 2) + "\n");
console.log(`完了: 暗号化 ${done} / スキップ ${skipped} / 音声なし ${missing}`);
