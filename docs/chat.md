Plan to implement                                                                                                                                          │
│                                                                                                                                                            │
│ リアルタイムグループチャット機能実装プラン                                                                                                                 │
│                                                                                                                                                            │
│ Context（背景）                                                                                                                                            │
│                                                                                                                                                            │
│ 現在のWebアプリは HTML + PostgreSQL + PostgREST で構築され、「極端に少なく依存関係もほぼない」という設計思想に基づいています。ユーザー同士がリアルタイムで │
│ コミュニケーションできるグループチャット機能を追加することで、アプリケーションの価値を大幅に向上させます。                                                 │
│                                                                                                                                                            │
│ 既存の JWT 認証、Row Level Security (RLS)、Alpine.js のパターンを最大限活用し、依存関係を最小限に保ちながらモダンなリアルタイムチャットを実装します。      │
│                                                                                                                                                            │
│ 選択したアプローチ                                                                                                                                         │
│                                                                                                                                                            │
│ - チャット形式: グループチャットルーム（複数ユーザーが参加可能）                                                                                           │
│ - リアルタイム通信: WebSocket（小規模 Node.js サーバー追加）                                                                                               │
│ - 使用ライブラリ: ws (WebSocket) + pg (PostgreSQL client) のみ（合計2つの依存のみ！）                                                                      │
│                                                                                                                                                            │
│ アーキテクチャ概要                                                                                                                                         │
│                                                                                                                                                            │
│ ┌─────────────┐      HTTP/REST       ┌──────────────┐                                                                                                      │
│ │             │◄────────────────────►│              │                                                                                                      │
│ │  Alpine.js  │                      │  PostgREST   │                                                                                                      │
│ │  Frontend   │      WebSocket       │   (port      │                                                                                                      │
│ │             │◄────────────────────┐│    3000)     │                                                                                                      │
│ └─────────────┘                     ││              │                                                                                                      │
│                                     │└──────────────┘                                                                                                      │
│                                     ││                                                                                                                     │
│                          ┌──────────▼┴──────────┐                                                                                                          │
│                          │  WebSocket Server    │                                                                                                          │
│                          │  (Node.js + ws)      │                                                                                                          │
│                          │  (port 3001)         │                                                                                                          │
│                          └──────────┬───────────┘                                                                                                          │
│                                     │                                                                                                                      │
│                          ┌──────────▼───────────┐                                                                                                          │
│                          │   PostgreSQL 18      │                                                                                                          │
│                          │   (port 5432)        │                                                                                                          │
│                          │   - chat_rooms       │                                                                                                          │
│                          │   - room_members     │                                                                                                          │
│                          │   - chat_messages    │                                                                                                          │
│                          └──────────────────────┘                                                                                                          │
│                                                                                                                                                            │
│ 役割分担                                                                                                                                                   │
│                                                                                                                                                            │
│ - PostgREST: チャットルーム一覧、メッセージ履歴の取得（既存パターン活用）                                                                                  │
│ - WebSocket Server: リアルタイムメッセージ配信、入室/退室通知、タイピングインジケーター                                                                    │
│ - PostgreSQL: データ永続化、RLSによるセキュリティ、JWT認証                                                                                                 │
│                                                                                                                                                            │
│ 実装詳細                                                                                                                                                   │
│                                                                                                                                                            │
│ 1. データベーススキーマ（新規SQLファイル）                                                                                                                 │
│                                                                                                                                                            │
│ sql/007_chat_schema.sql                                                                                                                                    │
│                                                                                                                                                            │
│ 3つのテーブルを作成：                                                                                                                                      │
│ - api.chat_rooms: チャットルーム（id, name, description, created_by, created_at）                                                                          │
│ - api.room_members: ルームメンバーシップ（id, room_id, user_id, joined_at）                                                                                │
│ - api.chat_messages: メッセージ（id, room_id, user_id, message, created_at）                                                                               │
│                                                                                                                                                            │
│ パフォーマンス最適化用インデックス：                                                                                                                       │
│ - idx_room_members_user, idx_room_members_room                                                                                                             │
│ - idx_messages_room_time (room_id, created_at DESC)                                                                                                        │
│                                                                                                                                                            │
│ 便利なビュー：                                                                                                                                             │
│ - api.my_chat_rooms: 自分が参加しているルーム一覧（メンバー数、メッセージ数含む）                                                                          │
│                                                                                                                                                            │
│ RPC関数（既存の signup/login パターンに従う）：                                                                                                            │
│ - api.create_chat_room(name, description): ルーム作成＆自動参加                                                                                            │
│ - api.join_chat_room(room_id): ルーム参加                                                                                                                  │
│ - api.leave_chat_room(room_id): ルーム退出                                                                                                                 │
│                                                                                                                                                            │
│ sql/008_chat_rls.sql                                                                                                                                       │
│                                                                                                                                                            │
│ Row Level Security ポリシー（既存の favorites_policy パターンに従う）：                                                                                    │
│ - chat_rooms: 自分が参加しているルームのみ閲覧可能                                                                                                         │
│ - room_members: 自分が参加しているルームのメンバーのみ閲覧可能                                                                                             │
│ - chat_messages: 自分が参加しているルームのメッセージのみ閲覧・投稿可能                                                                                    │
│                                                                                                                                                            │
│ 2. WebSocket サーバー（新規）                                                                                                                              │
│                                                                                                                                                            │
│ chat-server/package.json                                                                                                                                   │
│                                                                                                                                                            │
│ {                                                                                                                                                          │
│   "dependencies": {                                                                                                                                        │
│     "ws": "^8.18.0",                                                                                                                                       │
│     "pg": "^8.13.1"                                                                                                                                        │
│   }                                                                                                                                                        │
│ }                                                                                                                                                          │
│ 依存関係はたったの2つ！ - プロジェクトの哲学に完全合致                                                                                                     │
│                                                                                                                                                            │
│ chat-server/server.js (約250行)                                                                                                                            │
│                                                                                                                                                            │
│ 主要機能：                                                                                                                                                 │
│ - JWT検証: PostgreSQL の sign() 関数と同じアルゴリズム（HMAC-SHA256）                                                                                      │
│ - 接続管理: ユーザーごと、ルームごとの WebSocket 追跡                                                                                                      │
│ - メッセージブロードキャスト: ルームメンバー全員にリアルタイム配信                                                                                         │
│ - メンバーシップ確認: データベースクエリで参加権限を検証                                                                                                   │
│ - メッセージ永続化: PostgreSQL に保存（履歴として利用）                                                                                                    │
│                                                                                                                                                            │
│ メッセージプロトコル（JSON形式）：                                                                                                                         │
│ // クライアント→サーバー                                                                                                                                   │
│ { type: 'auth', token: 'JWT' }                                                                                                                             │
│ { type: 'join', roomId: 123 }                                                                                                                              │
│ { type: 'message', roomId: 123, message: 'Hello!' }                                                                                                        │
│ { type: 'typing', roomId: 123, isTyping: true }                                                                                                            │
│                                                                                                                                                            │
│ // サーバー→クライアント                                                                                                                                   │
│ { type: 'authenticated', user: {...} }                                                                                                                     │
│ { type: 'message', roomId: 123, message: {...} }                                                                                                           │
│ { type: 'user_joined', roomId: 123, user: {...} }                                                                                                          │
│ { type: 'typing', roomId: 123, user: {...}, isTyping: true }                                                                                               │
│                                                                                                                                                            │
│ chat-server/Dockerfile                                                                                                                                     │
│                                                                                                                                                            │
│ FROM node:20-alpine                                                                                                                                        │
│ # シンプルな本番用イメージ（約50MB）                                                                                                                       │
│                                                                                                                                                            │
│ 3. フロントエンド統合                                                                                                                                      │
│                                                                                                                                                            │
│ app.js の拡張                                                                                                                                              │
│                                                                                                                                                            │
│ 既存の bookApp() 関数を拡張（上書きではなく、プロパティ追加）：                                                                                            │
│                                                                                                                                                            │
│ 新規関数:                                                                                                                                                  │
│ - createChatClient(token): WebSocket クライアント（自動再接続機能付き）                                                                                    │
│   - 指数バックオフで再接続（1秒→2秒→4秒...最大30秒）                                                                                                       │
│   - イベントハンドラー登録（onMessage, onUserJoined, onTyping など）                                                                                       │
│                                                                                                                                                            │
│ 追加state:                                                                                                                                                 │
│ {                                                                                                                                                          │
│   chatClient: null,                                                                                                                                        │
│   chatConnected: false,                                                                                                                                    │
│   chatRooms: [],                                                                                                                                           │
│   currentRoomId: null,                                                                                                                                     │
│   currentRoomMessages: [],                                                                                                                                 │
│   typingUsers: {},                                                                                                                                         │
│   messageInput: '',                                                                                                                                        │
│   showChat: false                                                                                                                                          │
│ }                                                                                                                                                          │
│                                                                                                                                                            │
│ 追加メソッド:                                                                                                                                              │
│ - initChat(): WebSocket接続開始、イベントハンドラー設定                                                                                                    │
│ - loadChatRooms(): PostgREST経由でルーム一覧取得                                                                                                           │
│ - createRoom(name, description): RPC経由でルーム作成                                                                                                       │
│ - enterRoom(roomId): 履歴読み込み＆WebSocketでルーム参加                                                                                                   │
│ - sendChatMessage(): WebSocket経由でメッセージ送信                                                                                                         │
│ - handleTyping(): タイピングインジケーター送信                                                                                                             │
│ - toggleChat(): チャット画面の表示切り替え                                                                                                                 │
│                                                                                                                                                            │
│ 既存コードとの統合ポイント：                                                                                                                               │
│ - init(): ログイン済みなら initChat() を呼び出し                                                                                                           │
│ - applyToken(): 認証後に initChat() を呼び出し                                                                                                             │
│ - logout(): WebSocket切断、チャット状態をクリア                                                                                                            │
│                                                                                                                                                            │
│ index.html の拡張                                                                                                                                          │
│                                                                                                                                                            │
│ 新規UIコンポーネント（既存の main-screen 内に追加）:                                                                                                       │
│                                                                                                                                                            │
│ 1. チャット切り替えボタン（右下固定）:                                                                                                                     │
│ <button class="chat-toggle-btn" @click="toggleChat()">                                                                                                     │
│   <span x-text="showChat ? '📚 Books' : '💬 Chat'"></span>                                                                                                 │
│ </button>                                                                                                                                                  │
│ 2. チャット画面（全画面オーバーレイ）:                                                                                                                     │
│   - 左サイドバー: ルーム一覧、ルーム作成フォーム、接続状態表示                                                                                             │
│   - 右パネル: メッセージ一覧、タイピングインジケーター、メッセージ入力                                                                                     │
│                                                                                                                                                            │
│ Alpine.js ディレクティブ活用:                                                                                                                              │
│ - x-show="showChat": チャット画面の表示切り替え                                                                                                            │
│ - x-for="room in chatRooms": ルームリスト描画                                                                                                              │
│ - x-for="msg in sortedMessages": メッセージリスト描画                                                                                                      │
│ - x-model="messageInput": 入力欄の双方向バインディング                                                                                                     │
│ - @keyup.enter="sendChatMessage()": Enterキーで送信                                                                                                        │
│                                                                                                                                                            │
│ style.css の拡張（約200行追加）                                                                                                                            │
│                                                                                                                                                            │
│ - .chat-toggle-btn: 浮動ボタン（丸型、影付き）                                                                                                             │
│ - .chat-container: Flexbox 2カラムレイアウト                                                                                                               │
│ - .chat-sidebar: 左サイドバー（幅300px、スクロール可能）                                                                                                   │
│ - .chat-messages: メッセージリスト（フレックス、下揃え、自動スクロール）                                                                                   │
│ - .chat-message: メッセージバブル（ユーザー名、本文、時刻）                                                                                                │
│ - レスポンシブ対応（768px以下でサイドバー幅調整）                                                                                                          │
│                                                                                                                                                            │
│ 4. インフラ更新                                                                                                                                            │
│                                                                                                                                                            │
│ podman.yaml の変更                                                                                                                                         │
│                                                                                                                                                            │
│ 新しいコンテナを追加（既存の postgres, postgrest に加えて）:                                                                                               │
│                                                                                                                                                            │
│ - name: chat-server                                                                                                                                        │
│   image: localhost/chat-server:latest                                                                                                                      │
│   ports:                                                                                                                                                   │
│     - containerPort: 3001                                                                                                                                  │
│       hostPort: 3001                                                                                                                                       │
│   env:                                                                                                                                                     │
│     - name: WS_PORT                                                                                                                                        │
│       value: "3001"                                                                                                                                        │
│     - name: DATABASE_URL                                                                                                                                   │
│       value: "postgres://meimiku:meimiku@localhost:5432/meimiku"                                                                                           │
│     - name: JWT_SECRET                                                                                                                                     │
│       value: "my-super-secret-jwt-key-for-meimiku-2024"                                                                                                    │
│                                                                                                                                                            │
│ デプロイコマンド:                                                                                                                                          │
│ # chat-server イメージをビルド                                                                                                                             │
│ cd chat-server                                                                                                                                             │
│ podman build -t localhost/chat-server:latest .                                                                                                             │
│ cd ..                                                                                                                                                      │
│                                                                                                                                                            │
│ # Pod を再起動                                                                                                                                             │
│ podman pod stop meimiku                                                                                                                                    │
│ podman pod rm meimiku                                                                                                                                      │
│ podman play kube podman.yaml                                                                                                                               │
│                                                                                                                                                            │
│ セキュリティ対策                                                                                                                                           │
│                                                                                                                                                            │
│ 1. XSS防止: Alpine.js の x-text 使用（自動エスケープ）、メッセージは plain text のみ                                                                       │
│ 2. JWT検証: WebSocket サーバー側で署名と有効期限を検証                                                                                                     │
│ 3. RLS: データベースレベルでアクセス制御（不正なルームアクセスを防止）                                                                                     │
│ 4. メンバーシップ確認: WebSocket join 前にデータベースで参加権限を確認                                                                                     │
│ 5. 入力検証: メッセージ長制限（5000文字）、SQL インジェクション防止（パラメータ化クエリ）                                                                  │
│                                                                                                                                                            │
│ 検証方法                                                                                                                                                   │
│                                                                                                                                                            │
│ ステップ1: データベーステスト                                                                                                                              │
│                                                                                                                                                            │
│ psql postgres://meimiku:meimiku@localhost:5432/meimiku                                                                                                     │
│                                                                                                                                                            │
│ # ルーム作成テスト                                                                                                                                         │
│ SELECT api.create_chat_room('テストルーム', '説明');                                                                                                       │
│                                                                                                                                                            │
│ # 参加しているルーム確認                                                                                                                                   │
│ SELECT * FROM api.my_chat_rooms;                                                                                                                           │
│                                                                                                                                                            │
│ ステップ2: WebSocket サーバーテスト                                                                                                                        │
│                                                                                                                                                            │
│ ブラウザコンソールで:                                                                                                                                      │
│ const ws = new WebSocket('ws://localhost:3001');                                                                                                           │
│ ws.onopen = () => {                                                                                                                                        │
│   ws.send(JSON.stringify({                                                                                                                                 │
│     type: 'auth',                                                                                                                                          │
│     token: localStorage.getItem('token')                                                                                                                   │
│   }));                                                                                                                                                     │
│ };                                                                                                                                                         │
│ ws.onmessage = (e) => console.log(JSON.parse(e.data));                                                                                                     │
│                                                                                                                                                            │
│ ステップ3: エンドツーエンドテスト                                                                                                                          │
│                                                                                                                                                            │
│ 1. 2つのブラウザで異なるユーザーとしてログイン                                                                                                             │
│ 2. ユーザー1でルーム作成                                                                                                                                   │
│ 3. ユーザー2で /rpc/join_chat_room を使ってルーム参加                                                                                                      │
│ 4. 両方のブラウザでメッセージ送信                                                                                                                          │
│ 5. リアルタイム配信を確認                                                                                                                                  │
│ 6. タイピングインジケーターを確認                                                                                                                          │
│ 7. WebSocket切断→再接続を確認（DevToolsでネットワーク切断）                                                                                                │
│                                                                                                                                                            │
│ 重要ファイル一覧                                                                                                                                           │
│                                                                                                                                                            │
│ 新規作成（6ファイル）                                                                                                                                      │
│                                                                                                                                                            │
│ 1. sql/007_chat_schema.sql - チャットテーブル、インデックス、RPC関数                                                                                       │
│ 2. sql/008_chat_rls.sql - RLSポリシーと権限設定                                                                                                            │
│ 3. chat-server/server.js - WebSocketサーバー本体                                                                                                           │
│ 4. chat-server/package.json - Node.js依存関係定義                                                                                                          │
│ 5. chat-server/Dockerfile - コンテナイメージ定義                                                                                                           │
│ 6. chat-server/.dockerignore - ビルド除外設定                                                                                                              │
│                                                                                                                                                            │
│ 変更（4ファイル）                                                                                                                                          │
│                                                                                                                                                            │
│ 1. app.js - WebSocketクライアント追加、チャット機能統合（約+250行）                                                                                        │
│ 2. index.html - チャットUI追加（約+80行）                                                                                                                  │
│ 3. style.css - チャットスタイル追加（約+200行）                                                                                                            │
│ 4. podman.yaml - chat-serverコンテナ追加                                                                                                                   │
│                                                                                                                                                            │
│ 実装順序                                                                                                                                                   │
│                                                                                                                                                            │
│ 1. データベース → 007_chat_schema.sql, 008_chat_rls.sql 作成・実行                                                                                         │
│ 2. WebSocketサーバー → chat-server/ ディレクトリ作成、Dockerビルド                                                                                         │
│ 3. インフラ → podman.yaml 更新、Pod再デプロイ                                                                                                              │
│ 4. フロントエンドロジック → app.js 拡張                                                                                                                    │
│ 5. フロントエンドUI → index.html, style.css 拡張                                                                                                           │
│ 6. 統合テスト → マルチユーザーテスト                                                                                                                       │
│                                                                                                                                                            │
│ 設計上の選択理由                                                                                                                                           │
│                                                                                                                                                            │
│ なぜ ws ライブラリ？                                                                                                                                       │
│                                                                                                                                                            │
│ - socket.io は 20+ 依存、100KB+（依存関係最小の哲学に反する）                                                                                              │
│ - ws は 0 依存、2KB（完璧にマッチ）                                                                                                                        │
│ - モダンブラウザではネイティブ WebSocket で十分                                                                                                            │
│                                                                                                                                                            │
│ なぜハイブリッド（REST + WebSocket）？                                                                                                                     │
│                                                                                                                                                            │
│ - REST（PostgREST）: 履歴読み込み、ルーム管理（既存パターン活用）                                                                                          │
│ - WebSocket: リアルタイム配信のみ（責務分離）                                                                                                              │
│ - 各技術の強みを活かす                                                                                                                                     │
│                                                                                                                                                            │
│ なぜメッセージをDBに保存？                                                                                                                                 │
│                                                                                                                                                            │
│ - 履歴として永続化（ユーザー期待値）                                                                                                                       │
│ - RLSでセキュリティ保証                                                                                                                                    │
│ - PostgreSQLは既に存在（追加コストなし）                                                                                                                   │
│                                                                                                                                                            │
│ 今後の拡張可能性（スコープ外）                                                                                                                             │
│                                                                                                                                                            │
│ - ファイルアップロード機能                                                                                                                                 │
│ - メッセージ編集・削除                                                                                                                                     │
│ - 既読機能                                                                                                                                                 │
│ - デスクトップ通知                                                                                                                                         │
│ - Markdown対応                                                                                                                                             │
│ - 1対1ダイレクトメッセージ 
