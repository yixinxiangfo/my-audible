# my-audible

常備菜を作りながら聴く、自分専用の朗読解説ラジオ(音声は暗号化して公開)

- 再生ページ: https://yixinxiangfo.github.io/my-audible/ (合言葉が必要)
- 音声は暗号化してから置いている。台本(本の文章を含む)はこのリポジトリに入れていない

## 作り方

1. 本をスキャンして台本を書く(`scripts/`、この Mac の中だけ)
2. Gemini TTS で音声にする: `zsh -ic 'python3 tts/tts.py scripts/<番組>/<id>.txt work/<番組>/<id>.mp3'`
3. `episodes.json` に番組・章・ブロックを足す
4. 暗号化する: `node tools/encrypt.mjs`(`work/` の MP3 → `audio/` の .bin)
5. コミットして push する

合言葉の設定: `node tools/set-passphrase.mjs`(保存先は `~/.config/my-audible/passphrase`)
