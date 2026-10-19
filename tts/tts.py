#!/usr/bin/env python3
"""台本テキストを Gemini TTS で MP3 にする。

使い方:
  python3 tts/tts.py scripts/01_sarashina/01-01.txt audio/01_sarashina/01-01.mp3 [--voice Sulafat] [--lines 1-11]

- APIキーは環境変数 GEMINI_API_KEY から読む（ファイルには書かない）
- 出力先が既にあればスキップ（途中から再開できる）
- 使用トークンと実費の見積りを tts/usage_log.jsonl に記録し、予算を超えそうなら止める
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
USAGE_LOG = ROOT / "usage_log.jsonl"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"

# 台本のタグ → モデルのインラインタグ（山かっこ形式）。
# 声の調子を指定するタグ（[ゆっくり] など）は非対応なので削除し、style 指示に任せる。
PAUSE_TAGS = {"間をとって": "<long pause>", "少し間をとって": "<short pause>"}


def convert_tags(text):
    def repl(m):
        return PAUSE_TAGS.get(m.group(1).strip(), "")
    text = re.sub(r"\[([^\]]*)\]", repl, text)
    return re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"


def spent_jpy():
    if not USAGE_LOG.exists():
        return 0.0
    return sum(json.loads(l)["cost_jpy"] for l in USAGE_LOG.read_text().splitlines() if l.strip())


def cost_jpy(usage):
    p = CONFIG["price_usd_per_1m"]
    usd = usage.get("total_input_tokens", 0) * p["input_text"] / 1e6 \
        + usage.get("total_output_tokens", 0) * p["output_audio"] / 1e6
    return usd * CONFIG["usd_jpy"]


def request_tts(text, voice, retries=5):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY が設定されていません")
    body = {
        "model": CONFIG["model"],
        "input": [{"type": "user_input", "content": [{
            "type": "text", "text": text,
            "annotations": [{"type": "speech_metadata", "style": CONFIG["style"]}],
        }]}],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice}]},
    }
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.loads(r.read())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            wait = 10 * 2 ** attempt
            print(f"  失敗 ({getattr(e, 'code', e)})、{wait}秒待って再試行", file=sys.stderr)
            time.sleep(wait)
    sys.exit("再試行の上限に達しました")


def duration_sec(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    return float(out.stdout.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("out")
    ap.add_argument("--voice", default=CONFIG["voice"])
    ap.add_argument("--lines", help="使う行の範囲（例 1-11）。サンプル用")
    args = ap.parse_args()

    out = Path(args.out)
    if out.exists():
        print(f"スキップ（生成済み）: {out}")
        return
    lines = Path(args.script).read_text(encoding="utf-8").splitlines()
    if args.lines:
        a, b = map(int, args.lines.split("-"))
        lines = lines[a - 1:b]
    text = convert_tags("\n".join(lines))

    if spent_jpy() >= CONFIG["budget_jpy"] * 0.9:
        sys.exit(f"予算の9割に達しています（累計 約{spent_jpy():.0f}円）。停止します")

    print(f"生成中: {out}（{args.voice}、{len(text)}字）")
    resp = request_tts(text, args.voice)
    usage = resp.get("usage", {})
    audio = [c for s in resp.get("steps", []) for c in s.get("content", []) if c.get("type") == "audio"]
    if not audio:
        sys.exit("音声が返ってきませんでした")

    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "out.wav"
        wav.write_bytes(base64.b64decode(audio[-1]["data"]))
        # スマホのスピーカーでも聞こえるよう、ラジオ番組の標準的な音量（-16 LUFS）にそろえる
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
                        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "24000", "-ac", "1",
                        "-b:a", CONFIG["mp3_bitrate"], str(out)], check=True)

    paid_equiv = cost_jpy(usage)
    c = 0.0 if CONFIG.get("free_tier") else paid_equiv
    with USAGE_LOG.open("a") as f:
        f.write(json.dumps({"out": str(out), "voice": args.voice, "model": CONFIG["model"],
                            "input_tokens": usage.get("total_input_tokens"),
                            "output_tokens": usage.get("total_output_tokens"),
                            "cost_jpy": round(c, 3),
                            "paid_equiv_jpy": round(paid_equiv, 3)}, ensure_ascii=False) + "\n")

    dur = duration_sec(out)
    expected = len(text) / CONFIG["chars_per_minute"] * 60
    flag = "  ※短すぎる：途中で切れている可能性" if dur < expected * 0.6 else ""
    print(f"  完了 {dur:.1f}秒（目安 {expected:.0f}秒）約{c:.2f}円 / 累計 約{spent_jpy():.1f}円{flag}")


if __name__ == "__main__":
    main()
