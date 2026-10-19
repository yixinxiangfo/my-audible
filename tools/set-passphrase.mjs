#!/usr/bin/env node
// 再生ページの合言葉(パスワード)を設定する。
// 使い方: node tools/set-passphrase.mjs
// - 打った文字は画面に見える。最後に内容と文字数を表示し、y を押したときだけ保存する
// - すでに合言葉があるときは、変えるかどうか聞く
// - 保存先は ~/.config/my-audible/passphrase(このリポジトリの外。権限 600)
// - 合言葉を変えたら、node tools/encrypt.mjs --rekey で音声を暗号化し直す
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const DIR = join(homedir(), ".config", "my-audible");
const FILE = join(DIR, "passphrase");
const rl = createInterface({ input: process.stdin, output: process.stdout });

if (existsSync(FILE)) {
  console.log("合言葉はすでに設定されています。");
  const ans = (await rl.question("新しい合言葉に変えますか? (y/n): ")).trim().toLowerCase();
  if (ans !== "y") { console.log("変更しませんでした。"); rl.close(); process.exit(0); }
}

console.log("おすすめ: 英小文字と数字だけ、12文字以上(スマホで打ちやすく、全角になりにくい)");
const pass = (await rl.question("合言葉を入力して Enter: ")).trim();
if (pass.length < 8) { console.log("8文字以上にしてください。何も保存していません。"); rl.close(); process.exit(1); }
if (/[^\x21-\x7e]/.test(pass)) {
  console.log("半角の英数字と記号だけにしてください(全角・日本語・空白は使えません)。何も保存していません。");
  rl.close(); process.exit(1);
}

console.log("");
console.log("  この合言葉で保存します: " + pass);
console.log("  文字数: " + pass.length + "文字");
const ok = (await rl.question("これでよければ y、やり直すなら n: ")).trim().toLowerCase();
rl.close();
if (ok !== "y") { console.log("保存しませんでした。もう一度実行してください。"); process.exit(0); }

mkdirSync(DIR, { recursive: true, mode: 0o700 });
writeFileSync(FILE, pass, { mode: 0o600 });
console.log("保存しました。");
console.log("※ ターミナルの画面に合言葉が残っています。気になる場合は ⌘K で画面を消してください。");
