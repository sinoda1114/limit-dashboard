# AI Usage Cockpit

Codex、Cursor、Claude.ai、Claude Code のサブスクリプション利用状況を、1つのダッシュボードで確認するためのアプリです。

このプロジェクトは、手入力や従量課金 API 連携には依存せず、各サービスの利用状況ページ（rate limit / usage 表示）から収集した値のみを表示します。

## できること

- 複数サービスの利用状況を一画面で確認
- Chrome 拡張による定期収集（バックグラウンド更新）
- 必要に応じて Redis へスナップショットを保存
- Claude Code の status line から追加の rate-limit 情報を取り込み（任意）

## ローカル起動

```bash
npm install
npm run dev
```

起動後、以下を開きます。

- ダッシュボード: `http://127.0.0.1:43177`
- 取り込み API: `http://127.0.0.1:43177/api/ingest`

## Vercel で公開する

このアプリは Vercel にデプロイして公開できます。  
利用状況の収集は、ユーザーのブラウザに入れた Chrome 拡張が継続して実行します。

最小構成（個人利用向け）の環境変数:

```text
NEXT_PUBLIC_DASHBOARD_URL=https://your-project.vercel.app
```

この構成では、Chrome 拡張が最新スナップショットを `chrome.storage.local` に保存し、ダッシュボード表示時に直接反映します。Redis は必須ではありません。

サーバー側バックアップを有効化する場合（任意）:

```text
COLLECTOR_INGEST_TOKEN=generate-a-long-random-token
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

- `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` を設定すると、スナップショットと collector コマンドを Redis に永続化します。
- Redis がない場合、ローカル開発では `.data/usage.json` にフォールバックします。Vercel 環境でも、拡張機能を入れた Chrome でダッシュボードを開いていればローカルスナップショット表示は可能です。

## Chrome 拡張（Web Collector）設定

`collector-extension` を unpacked extension として読み込みます。

1. `chrome://extensions` を開く
2. デベロッパーモードを有効化
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `collector-extension` ディレクトリを選択
5. 拡張機能の詳細画面から「拡張機能のオプション」を開く
6. ローカル開発時は `Dashboard URL` を `http://127.0.0.1:43177` のまま使用
7. Vercel 運用時は `Dashboard URL` を Vercel の URL に変更（`Collector Token` はサーバーバックアップ有効時のみ必要）
8. 未ログインなら各サービスの利用状況ページを一度開いてログイン
  - `https://cursor.com/ja/dashboard/spending`
  - `https://chatgpt.com/codex/cloud/settings/analytics#usage`
  - `https://claude.ai/settings/usage`

### 収集データと安全性

- 拡張機能はブラウザ上で表示中テキストをローカル解析し、利用状況メトリクスのみを送信します。
- パスワード、Cookie、認証トークン、ページ全文は受信・保存しません。

### 自動更新動作

- インストール後は、3つの利用状況ページを非アクティブタブで約1分ごとに更新します。
- 収集用に開いたタブは送信後に自動クローズされます。
- 再ログインが必要になった場合は、該当サービスページを手動で開いてログインしてください。

## Claude Code status line 連携（任意）

`https://claude.ai/settings/usage` 由来のデータに加えて、Claude Code の status line JSON から CLI 特有の `rate_limits` を取り込めます。

Claude Code 側で、次のいずれかの方法でスクリプトを呼び出してください。

```bash
# 方法1: プロジェクトのルートディレクトリを作業ディレクトリにして実行（推奨）
node ./scripts/claude-statusline.js
```

```bash
# 方法2: 作業ディレクトリに依存しないよう環境変数でルートを指定して実行
# 例（macOS / Linux / Git Bash）
AI_USAGE_COCKPIT_ROOT=/path/to/limit-dashboard
node "$AI_USAGE_COCKPIT_ROOT/scripts/claude-statusline.js"
```

```powershell
# 例（PowerShell）
$env:AI_USAGE_COCKPIT_ROOT = "C:\path\to\limit-dashboard"
node "$env:AI_USAGE_COCKPIT_ROOT\scripts\claude-statusline.js"
```

このスクリプトは標準入力の JSON から `rate_limits` を抽出し、`/api/ingest` へ送信したうえで、短い status line を出力します。

Vercel 経由で送る場合:

```bash
AI_USAGE_DASHBOARD_URL=https://your-project.vercel.app/api/ingest
AI_USAGE_DASHBOARD_TOKEN=the-same-value-as-COLLECTOR_INGEST_TOKEN
```

## 注意事項

Cursor と Codex には、現時点で公開・安定したサブスクリプション利用量 API がありません。  
そのため Web Collector は、各社ダッシュボードの DOM 変更に追従しやすいよう、意図的に小さく保守しやすい実装にしています。