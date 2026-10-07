# Comment to Picture

画像やPDFに矩形のコメントをつけ、全ページの位置・コメントをJSONでAIへ渡すブラウザツール。

公開: https://hirazisora.github.io/comment-to-picture/

## 操作

画像・PDFを追加 → ドラッグで範囲指定 → コメント保存 → JSONをコピー、またはJSONファイル保存。範囲の割合は数値欄でも編集可能。入力途中のページ移動や出力では、保存・破棄・編集継続を選べます。同名かつ同じ内容の再追加はローカルSHA-256で検出しスキップします。別ファイルはfile_idで区別します。

元画像はJSONに含みません。AIへはJSONと元ファイルを別々に渡してください。座標は表示した画像／回転済PDF CropBoxの左上が(0,0)、右下が(1,1)。PDF原寸はポイント、画像原寸はピクセルです。全ページ（コメント0件も含む）を出力します。

## プライバシーと制約

- ファイルとコメントはタブのメモリ内のみ。サーバー送信、解析、広告、外部フォント、外部CDNなし。サイト表示時にはGitHub Pagesから静的資産を取得します。
- CSPで外部通信・フォーム送信を制限。PDFはバイト列で読み込み、同梱のPDF.js worker・CMaps・標準フォント・WASMを使用します。
- リロード・タブ終了で作業は消えます。JSONを先に保存してください。JSONの再読込による作業復元は未対応です。
- 1ファイル50MiB、合計150MiB、100ページ、画像4000万画素、描画約800万画素。PDF読み込み30秒・ページ情報10秒・画像15秒でタイムアウト。パスワード付きPDFは未対応。GIFは最初のフレーム。
- PNG、JPEG、WebP、GIF、BMP、PDF。現行のChrome・Edge・Firefox・Safari向け。クリップボード拒否時は手動コピー画面を表示します。
- 中止は読み込み中のファイルを破棄し、先に完了したファイルを維持します。取り除く操作は確認付き。

## 開発

依存インストール不要（PDF.js静的資産を同梱）。Node.js 22以上。

```sh
node --test tests/model.test.mjs
node scripts/build.mjs
node scripts/serve.mjs
```

http://127.0.0.1:4173 を開く。Pages workflowはテスト・ビルド後にdistのみデプロイ。ユーザー実ファイルや生成テスト成果物はコミットしません。

UIテストは開発用Playwright・pdf-lib・pngjsとPythonのpypdfが必要です。ローカルサーバー起動後、`node tests/browser.mjs`（`TEST_MODULES`でNodeパッケージのディレクトリ、`TEST_PYTHON`でPython実行ファイル、`TEST_URL`で公開サイトを指定可能）。自作テストファイル・スクリーンショット・通信記録はgit除外した`test-results/`に生成します。

## 第三者ライセンス

PDF.js 5.6.205 (Mozilla contributors), Apache-2.0。`src/vendor/pdfjs/LICENSE`に同梱。フォントなどのライセンスは各資産に付属。
