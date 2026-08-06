# Codex レビュー用プロンプト

以下をそのままCodexに渡してください。

---

## 依頼

以下の実装計画をレビューしてください。
漏れ・矛盾・リスク・改善案を指摘してほしいです。

---

## プロジェクト概要

水商売（キャバクラ等）の店舗運営を支援する「朝礼・終礼シート」アプリ。

**技術スタック:**
- Express.js (v5) バックエンド
- Vanilla JS フロントエンド（SPA、ビルドプロセスなし）
- Google Sheets API がデータストア（RDB不使用）
- Google OAuth 2.0 認証
- Chart.js 4.4 でグラフ描画
- Vercelデプロイ対応

**現在の構成:**
- ログイン → 店舗選択 → マネージャー画面 or キャスト画面
- マネージャー: 朝礼（出勤キャスト登録）、終礼（売上入力・自己評価）、送迎、伝言板
- キャスト: 目標入力、朝礼閲覧、終礼閲覧、振り返り（自己採点）、伝言板閲覧
- 本部（senior_manager/manager/executive）: 店舗選択 → ダッシュボード（売上/出勤/キャスト/伝言板の4タブ）

**Google Sheetsのデータ構造:**
- `chorei`: date, storeCode, castName, gmail, monthlySales, monthlyDrinks, expectedVisitors, castGoal, managerMemo, needsPickup, pickupDestination, createdAt
- `shurei`: date, storeCode, salesToday, monthlySales, createdAt
- `self_evaluation`: date, storeCode, castName, gmail, score, comment, isEarlyLeave, createdAt
- `issues`: id, date, storeCode, reporter, content, status(未対応/対応中/完了), feedback, completedAt, createdAt
- `config_users`: email, role, (reserved×2), selectedStore, castName
- `config_stores`: isActive, storeCode, storeName, area, areaCode, displayOrder

---

## 上司からの要望

### 1ページ一覧で以下の確認ができるように（現在は店舗選択→タブ切替が必要）

- 月次店舗売上
- 目標売上達成率
- 先月の同日時点累計売上
- 前年の同日時点累計売上
- 出勤キャスト
- 出勤キャストの月次個人成績
- 出勤キャストの月次杯数
- 出勤キャストの研修○日目

### 別ページ遷移でOK

- 何を周知しているか（周知事項）
- どんな課題やトラブルがあったか
- 終礼では、キャストからの課題の進捗管理ができるように

### 通知

- 朝礼/終礼シートが更新されたらLINE通知を飛ばす
- 目的: 「その日店が開いているか/閉められているか」の確認（過去にこれでトラブルを防いだ実績あり）

---

## 実装計画

### Phase 1: データ基盤

**新シート追加（DATAスプレッドシート）:**
- `sales_targets`: yearMonth, storeCode, targetSales, updatedAt（月別店舗売上目標）
- `announcements`: id, date, storeCode, author, content, createdAt（周知事項、伝言板とは分離）

**既存シート変更:**
- `config_users`に列G `trainingStartDate`を追加（研修開始日）

**バックエンド変更:**
- `config-reader.js`: getAllUsers()の範囲をA2:G500に拡張、trainingStartDate読取
- `data-store.js`: 以下の関数追加
  - `getSalesTargets(yearMonth)` / `saveSalesTarget()`
  - `getAnnouncements(storeCode)` / `createAnnouncement()`
  - `getOverviewData(businessDate)` — batchGetで全店舗のchorei + shurei + 先月同日shurei + 前年同日shurei + 目標を一括取得
- shurei読取範囲を `A2:E5000` → `A2:E10000` に拡張

**先月/前年比較ロジック:**
- 営業日2026-04-06なら、先月同日=2026-03-06、前年同日=2025-04-06のshureiからmonthlySalesを取得
- 該当日にデータがない場合はnull表示

**研修日数計算:**
- trainingStartDateから今日までのカレンダー日数（出勤日ベースではない）
- trainingStartDateが空＝研修完了済（表示なし）

**新APIエンドポイント:**
```
GET  /api/overview                    → 本部一覧（全店舗一括）
GET  /api/sales-targets?yearMonth=    → 売上目標取得
POST /api/sales-targets               → 売上目標保存
GET  /api/announcements?storeCode=    → 周知事項取得
POST /api/announcements               → 周知事項投稿
GET  /api/issues/all                  → 全店舗の課題一覧
```

### Phase 2: 本部一覧画面

全店舗をカード形式で1ページ表示。各カードに:
- 売上4指標（月次累計/目標達成率/先月同日/前年同日）
- 出勤キャストテーブル（名前/月次売上/月次杯数/研修日数）

Admin画面の「ダッシュボード」ボタンの遷移先を変更。既存ダッシュボードは「詳細分析」として残す。

### Phase 3: 別ページ

- 周知事項画面: 投稿・一覧・店舗フィルター
- 課題一覧画面: 全店舗横断、ステータスフィルター、ステータス変更・FB入力
- 終礼画面に「本日の課題進捗」セクション追加（未完了課題の進捗更新）

### Phase 4: LINE通知

- `src/notifications/line-notify.js`を新規作成
- LINE Messaging APIでグループに通知（Node.js標準fetchでHTTP POST）
- server.jsの`POST /api/chorei`と`POST /api/shurei`成功後にfire-and-forgetで呼出
- 通知失敗時はconsole.errorのみ（メイン処理はブロックしない）

### Phase 5: 仕上げ

- セッション復元対応
- モバイルレスポンシブ
- 既存ダッシュボードへの導線

---

## レビュー観点

以下の観点で指摘をお願いします:

1. **要件の漏れ**: 上司の要望に対して、この計画で満たせていない点はあるか？
2. **データ設計**: 新シート構造に問題はないか？既存データとの整合性は？
3. **API設計**: エンドポイント設計に無駄や不足はないか？
4. **パフォーマンス**: Google Sheets APIのレート制限（60req/min/user）を考慮して、getOverviewData()のbatchGet戦略は妥当か？shurei 10,000行の全量読込は問題にならないか？
5. **先月/前年の同日ロジック**: 月末日のエッジケース（3/31の先月同日は2/28?）は適切に処理されているか？
6. **LINE通知**: LINE Messaging APIの選定は妥当か？LINE Notifyの廃止を踏まえた代替として適切か？グループIDの取得方法は現実的か？
7. **フロントエンド肥大化**: app.jsが既に2018行。追加で400-500行増える見込みだが、ファイル分割すべきか？
8. **セキュリティ**: 新エンドポイントの認証・認可は十分か？
9. **移行リスク**: 既存機能への影響（既存ダッシュボードの退避、config_usersのカラム追加）でデグレしないか？
10. **スケーラビリティ**: 店舗数が増えた場合（10店舗→30店舗）、1ページ一覧は破綻しないか？
11. **その他改善案**: この計画全体に対して、より良いアプローチがあれば提案してほしい
