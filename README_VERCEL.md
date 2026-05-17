# 🚀 Vercel デプロイ・Web公開マニュアル

このファイルでは、開発した「条文暗記・音声読み上げアプリ」を本番環境（Vercel）にデプロイし、インターネット経由でPCやスマートフォンから利用可能にするための手順を解説します。

---

## 🛠️ デプロイ方法

以下の2つの方法のうち、お好みの方法を選択してください。**「方法1：GitHub連携」が最も簡単で、今後の更新も自動化されるため推奨されます。**

---

### 💡 方法1：GitHub連携による自動デプロイ（推奨）

この方法では、コードをご自身のGitHubにプッシュするだけで、Vercelが自動的に検知してデプロイを行います。以降、コードを修正してプッシュするたびにWebサイトも自動で最新状態に更新されます。

#### 1. コードをGitHubにプッシュする
1. ご自身のGitHubアカウントで新規リポジトリ（例: `gyoseishoshi-memorizer`）を作成します。
2. ローカルプロジェクトディレクトリでGitを初期化し、リポジトリにプッシュします：
   ```bash
   git init
   git add .
   git commit -m "feat: add Vercel serverless compatibility"
   git branch -M main
   git remote add origin https://github.com/あなたのユーザー名/gyoseishoshi-memorizer.git
   git push -u origin main
   ```

#### 2. Vercelでプロジェクトをインポートする
1. [Vercel公式サイト](https://vercel.com/)にアクセスし、ログインします（GitHubアカウントでのログインがスムーズです）。
2. ダッシュボードで **「Add New...」** ➔ **「Project」** を選択します。
3. リポジトリ一覧から、先ほどプッシュした `gyoseishoshi-memorizer` を探し、**「Import」** をクリックします。
4. 設定画面が表示されますが、**設定はすべてデフォルトのままでOK**です（Vercelが `vercel.json` や静的フォルダを自動認識します）。
5. **「Deploy」** ボタンをクリックします。

約30秒〜1分でデプロイが完了し、`https://gyoseishoshi-memorizer-xxxx.vercel.app` のような世界で一つだけの公開URLが自動発行されます！🎉

---

### 💻 方法2：Vercel CLIによる即時デプロイ（コマンド操作）

Gitを使用せず、コマンドラインから直接その場でアップロードして公開する方法です。

#### 1. Vercel CLIをインストールする
PowerShellやコマンドプロンプトで以下を実行し、Vercelのコマンドラインツールをインストールします（Node.jsがインストールされている必要があります）。
```bash
npm install -g vercel
```

#### 2. ログインしてデプロイを実行する
1. アプリケーションのルートフォルダ（`gyoseishoshi_memorizer`）内で、以下のコマンドを実行します：
   ```bash
   vercel
   ```
2. 画面の指示に従ってログインおよび初期設定を行います：
   * `Set up and deploy “...\gyoseishoshi_memorizer”? [y/N]` ➔ **`y`** を入力
   * `Which scope do you want to deploy to?` ➔ 自分のアカウントを選択
   * `Link to existing project? [y/N]` ➔ **`N`** （新規プロジェクト作成）
   * `What’s your project’s name?` ➔ そのままエンター（または任意の名前）
   * `In which directory is your code located?` ➔ `./`（そのままエンター）
   * `Want to modify these settings? [y/N]` ➔ **`N`** （デフォルトのまま）

3. アップロードとビルドが自動で開始されます。
4. 完了すると、**Production URL** がターミナルに表示されます。

---

## 🌟 サーバーレス環境での仕様と特徴

### 1. 超高速静的配信（Edge CDN）
アプリのHTML、CSS、JavaScriptは、VercelのグローバルCDNエッジサーバーに配置されます。ユーザーの物理的な場所に最も近いサーバーから瞬時に配信されるため、スマートフォンの回線（4G/5G）でも驚くほどの軽快さで初期画面がロードされます。

### 2. e-Gov APIとのハイブリッド接続
法令データを検索または選択した際、Vercel上のサーバーレス関数（`/api/index.js`）がデジタル庁の e-Gov API v2 にアクセスして、リアルタイムで条文を取得・パースします。

### 3. 一時キャッシュ保護 (`/tmp`)
Vercelのサーバーレス環境は読み取り専用ですが、書き込み可能な `/tmp` 領域を活用するように改修してあります。
* APIから一度取得した法令は、自動的に `/tmp/data/cache/` に保存されます。
* 同一の法令リクエストは、二度目以降はデジタル庁への再通信を挟まず、キャッシュから瞬時（10ミリ秒以内）に返されるため、通信遅延を極限まで低減します。
* ※サーバーレス関数の特性上、コンテナがスリープ・再起動した場合はキャッシュが一時的にクリアされますが、ユーザーが再度アクセスした際に自動でe-Gov APIから最新版をサイレント再取得するため、ユーザー側には何の影響もありません。
