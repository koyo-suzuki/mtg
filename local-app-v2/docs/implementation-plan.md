# 実装計画: 本部一覧ページ・通知・課題進捗管理

## Context

上司からのFBに基づき、現在のダッシュボード（店舗選択 → タブ切替）を刷新し、**1ページで全店舗の状況が一覧できる本部画面**を構築する。加えて、周知事項・課題管理の分離、朝礼/終礼更新時のLINE通知機能を追加する。

---

## Phase 1: データ基盤の追加

### 1-1. Google Sheets に新シート追加（手動）

**DATA スプレッドシートに追加:**

| シート名 | カラム | 説明 |
|----------|--------|------|
| `sales_targets` | yearMonth, storeCode, targetSales, updatedAt | 月別店舗売上目標 |
| `announcements` | id, date, storeCode, author, content, createdAt | 周知事項（伝言板とは分離） |

**CONFIG スプレッドシートの変更:**

- `config_users` シートに列G `trainingStartDate` を追加（例: `2026-04-01`）
- 研修中のキャストのみ値を入れ、研修完了者は空欄

### 1-2. config-reader.js の修正

**ファイル:** `src/sheets/config-reader.js`

- `getAllUsers()`: 読取範囲を `A2:G500` に変更、`trainingStartDate: r[6]` を追加
- `getUserByEmail()`: `trainingStartDate` をレスポンスに含める

### 1-3. data-store.js に新関数追加

**ファイル:** `src/sheets/data-store.js`

```
// 売上目標
getSalesTargets(yearMonth) → sales_targets シートから読取
saveSalesTarget({ yearMonth, storeCode, targetSales }) → 追加/更新

// 周知事項
getAnnouncements(storeCode) → announcements シートから読取（storeCode='all' 含む）
createAnnouncement({ date, storeCode, author, content }) → 追加

// 一覧用データ取得（batchGet で一括）
getOverviewData(businessDate) → 全店舗の本日chorei + shurei + 先月同日shurei + 前年同日shurei + 目標 を一括取得
```

**先月/前年の同日データ取得ロジック:**
- 営業日が `2026-04-06` の場合:
  - 先月同日 = `2026-03-06` の shurei から `monthlySales` を取得
  - 前年同日 = `2025-04-06` の shurei から `monthlySales` を取得
- shurei シートの読取範囲を `A2:E10000` に拡張（1年以上のデータ対応）

**研修日数の計算:**
- `trainingStartDate` から今日までのカレンダー日数をカウント
- 研修開始日が空の場合 = 研修完了済（表示なし）

### 1-4. server.js に新APIエンドポイント追加

**ファイル:** `server.js`

```
GET  /api/overview                    → 本部一覧データ（全店舗一括）
GET  /api/sales-targets?yearMonth=    → 売上目標取得
POST /api/sales-targets               → 売上目標保存
GET  /api/announcements?storeCode=    → 周知事項取得
POST /api/announcements               → 周知事項投稿
GET  /api/issues/all                  → 全店舗の課題一覧
```

**announcements の権限:**
- `GET /api/announcements`: 認証済みユーザー全員（cast 含む）が閲覧可能
- `POST /api/announcements`: `cast_manager` 以上（`cast_manager`, `senior_manager`, `manager`, `executive`）のみ投稿可能

---

## Phase 2: 本部一覧画面（メイン）

### 2-1. HTML追加

**ファイル:** `public/index.html`

新しい `#overviewScreen` セクションを追加:

```
overviewScreen
├── ヘッダー: "本部一覧" + 日付表示 + 戻るボタン
├── ナビボタン: [周知事項] [課題一覧]
├── 店舗カード × N （全店舗分、スクロール）
│   ├── 店舗名ヘッダー
│   ├── 売上サマリー行:
│   │   ├── 月次累計売上（今月）
│   │   ├── 目標達成率（%）
│   │   ├── 先月同日累計
│   │   └── 前年同日累計
│   └── 出勤キャストテーブル:
│       ├── キャスト名
│       ├── 月次個人売上
│       ├── 月次杯数
│       └── 研修○日目（該当者のみ）
```

### 2-2. CSS追加

**ファイル:** `public/styles/style.css`

- 店舗カードのレイアウト（カード型、スマホ対応）
- 売上メトリクスの4カラムグリッド
- キャストテーブルのスタイル
- 達成率に応じた色分け（100%以上=緑、80%以上=黄、未満=赤）

### 2-3. JavaScript追加

**ファイル:** `public/scripts/app.js`

```javascript
showOverviewScreen()     // 画面表示、データ読込開始
loadOverviewData()       // GET /api/overview を呼出
renderOverview(data)     // 店舗カード生成、DOM更新
```

- Admin画面の「ダッシュボード」ボタン → `showOverviewScreen()` に変更
- 既存のダッシュボードは「詳細分析」として残す（一覧から遷移可能）

---

## Phase 3: 別ページ（周知事項・課題管理）

### 3-1. 周知事項画面

**HTML:** `#announcementsScreen` を追加
- 投稿フォーム（内容 + 対象店舗選択）
- 一覧表示（新しい順）
- 全店舗共通 / 店舗個別のフィルター
- 閲覧は全ユーザー（cast 含む）に開放
- 投稿フォームは `cast_manager` 以上のみ表示

**JS:** `showAnnouncementsScreen()`, `loadAnnouncements()`, `createAnnouncement()`

### 3-2. 課題一覧・進捗管理画面

**HTML:** `#allIssuesScreen` を追加
- 全店舗の課題を一覧表示（店舗フィルター付き）
- ステータス別フィルター（未対応/対応中/完了）
- 各課題のステータス変更・FB入力機能

**終礼での課題進捗管理:**
- 既存の終礼画面（Manager側）に「本日の課題進捗」セクションを追加
- その店舗の未完了課題を表示し、進捗更新ができるようにする

---

## Phase 4: LINE通知

### 4-1. 通知モジュール作成

**新規ファイル:** `src/notifications/line-notify.js`

- LINE Messaging API を使用
- `.env` に `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_NOTIFY_GROUP_ID` を追加
- `package.json` に依存追加不要（`fetch` で直接HTTP POST）

```javascript
notifyChoreiSaved(storeName, date, castNames)
// → "[朝礼完了] 店舗名 (2026-04-06)\n出勤: A, B, C"

notifyShureiSaved(storeName, date, salesToday, monthlySales)
// → "[終礼完了] 店舗名 (2026-04-06)\n本日売上: ¥120,000\n月次累計: ¥2,500,000"
```

### 4-2. server.js に通知トリガー追加

- 朝礼/終礼の通常保存（オートセーブ）は通知しない
- 「確定」操作用のAPIを追加して、そのときだけ通知する
  - `POST /api/chorei/confirm` 成功後 → `notifyChoreiSaved()` を fire-and-forget で呼出
  - `POST /api/shurei/confirm` 成功後 → `notifyShureiSaved()` を fire-and-forget で呼出
- 通知失敗時はログに記録するのみ（メイン処理をブロックしない）

---

## Phase 5: 仕上げ

- セッション復元対応（新画面のスクリーン名を `sessionStorage` に保存）
- モバイルレスポンシブ確認
- 既存ダッシュボードへの導線整理（「詳細分析」リンク）

---

## 修正対象ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/sheets/config-reader.js` | `trainingStartDate` 読取追加 |
| `src/sheets/data-store.js` | overview/targets/announcements関数追加、shurei範囲拡張 |
| `server.js` | 新APIエンドポイント追加、LINE通知トリガー |
| `public/index.html` | overview/announcements/allIssues画面のHTML |
| `public/scripts/app.js` | 新画面のロジック全般 |
| `public/styles/style.css` | 新画面のスタイル |
| `src/notifications/line-notify.js` | **新規** LINE通知モジュール |
| `.env` | LINE API トークン追加 |

## 検証方法

1. ローカルで `npm start` → ログイン → Admin画面 → 「ダッシュボード」で一覧画面表示確認
2. 各店舗のデータ（売上・キャスト・研修）が正しく表示されるか確認
3. 周知事項の投稿・表示テスト
4. 課題一覧の全店舗表示・フィルターテスト
5. 朝礼/終礼の「確定」操作を実行 → LINE通知が1回だけ届くか確認
6. スマートフォン表示でレイアウト崩れがないか確認
