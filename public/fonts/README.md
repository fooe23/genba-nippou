# 同梱フォント

工事原価集計表などの PDF（`src/lib/pdf/fonts.ts`）がサーバー側で読み込むフォント。実行時に CDN は使わない。

| ファイル | 入手元 | サイズ | SHA-256 |
| --- | --- | --- | --- |
| `NotoSansJP-Regular.otf` | https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf | 4,533,028 bytes | `dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073` |
| `NotoSansJP-Bold.otf` | https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf | 4,656,448 bytes | `1b0edfb500b73a4fa8a4fcaae1bbbd403994e08e73e3e0da37e70d3853f42c5f` |
| `OFL.txt` | https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE | 4,301 bytes | |

- 取得日：2026-11-03（notofonts/noto-cjk の main ブランチ）。
- ライセンス：SIL Open Font License 1.1（`OFL.txt`）。
- Google Fonts（google/fonts の `ofl/notosansjp/`）は可変フォント `NotoSansJP[wght].ttf`（約 9.6 MB）しか無いため、静的な Regular・Bold の日本語サブセット OTF を使っている。
