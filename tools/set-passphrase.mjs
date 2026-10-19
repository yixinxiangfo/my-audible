#!/usr/bin/env node
// 再生ページの合言葉(パスワード)を設定する。
// 使い方: node tools/set-passphrase.mjs
// - 入力した文字は画面に表示されない
// - 保存先は ~/.config/my-audible/passphrase(このリポジトリの外。権限 600)
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".config", "my-audible");
const FILE = join(DIR, "passphrase");

// 入力を画面に出さずに1行読む
function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.exit(1);
      } else if (ch === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

if (existsSync(FILE)) {
  console.log("合言葉はすでに設定されています。変えると、今までの音声を暗号化し直す必要があります。");
  console.log("変える場合は、先に次のファイルを削除してから、もう一度実行してください:");
  console.log("  " + FILE);
  process.exit(0);
}

const a = await askHidden("合言葉を入力(8文字以上): ");
if (a.length < 8) { console.log("8文字以上にしてください。"); process.exit(1); }
const b = await askHidden("もう一度入力: ");
if (a !== b) { console.log("一致しませんでした。もう一度やり直してください。"); process.exit(1); }

mkdirSync(DIR, { recursive: true, mode: 0o700 });
writeFileSync(FILE, a, { mode: 0o600 });
console.log("保存しました。スマホで最初にページを開くときに、同じ合言葉を入れてください。");
