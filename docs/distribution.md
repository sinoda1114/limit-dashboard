# Chrome Extension Distribution (GitHub First)

このプロジェクトは、最初の配布チャネルとして GitHub Releases を利用します。  
Chrome Web Store は後続フェーズで対応します。

## 配布の基本方針

- Web ダッシュボードは既存のまま維持
- 拡張機能は `collector-extension/` から配布
- リリースアセットは Git タグ作成で自動生成

## リリース手順

1. `collector-extension/manifest.json` の `version` を更新
2. 変更を `main` にマージ
3. タグを作成して push

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. GitHub Actions `Release Chrome Extension` が実行される
5. Releases に `ai-usage-collector-vX.Y.Z.zip` が添付される

## テスター向け導入手順

1. GitHub Releases から zip をダウンロード
2. 任意フォルダへ展開
3. `chrome://extensions` を開く
4. デベロッパーモードを有効化
5. 「パッケージ化されていない拡張機能を読み込む」
6. 展開したフォルダを指定

## 運用メモ

- Git タグ（例: `v0.1.0`）と `manifest.json` の `version` を揃える
- 配布前にローカルで動作確認（収集ページ + ダッシュボード連携）
- トークン運用時は共有方法を限定し、公開リポジトリへ平文で残さない
