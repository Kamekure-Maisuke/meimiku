const API = "http://localhost:3000";
const WS_URL = "ws://localhost:3001";
const PAGE_SIZE = 10;

// ============================================================
// i18n (Internationalization)
// ============================================================
// i18nData is defined in i18n.js

function detectLanguage() {
  const stored = localStorage.getItem('language');
  if (stored && (stored === 'ja' || stored === 'en')) return stored;

  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith('ja') ? 'ja' : 'en';
}

function parseJwt(t) {
  try {
    return JSON.parse(atob(t.split(".")[1]));
  } catch {
    return null;
  }
}

// ============================================================
// WebSocket Chat Client
// ============================================================

function createChatClient(token, onMessage, onUserJoined, onUserLeft, onTyping, onConnected, onDisconnected) {
  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000; // Start with 1 second
  const maxReconnectDelay = 30000; // Max 30 seconds
  let isConnected = false;
  let intentionallyClosed = false;

  function connect() {
    if (intentionallyClosed) return;

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
      isConnected = true;
      reconnectDelay = 1000; // Reset delay on successful connection

      // Authenticate
      ws.send(JSON.stringify({ type: 'auth', token: token }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'authenticated') {
          console.log('Authenticated:', data.user);
          if (onConnected) onConnected();
        } else if (data.type === 'message' && onMessage) {
          onMessage(data);
        } else if (data.type === 'user_joined' && onUserJoined) {
          onUserJoined(data);
        } else if (data.type === 'user_left' && onUserLeft) {
          onUserLeft(data);
        } else if (data.type === 'typing' && onTyping) {
          onTyping(data);
        } else if (data.type === 'error') {
          console.error('WebSocket error:', data.message);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      isConnected = false;
      if (onDisconnected) onDisconnected();

      if (!intentionallyClosed) {
        // Attempt to reconnect with exponential backoff
        console.log(`Reconnecting in ${reconnectDelay}ms...`);
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
          connect();
        }, reconnectDelay);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  function close() {
    intentionallyClosed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  // Start connection
  connect();

  return {
    send,
    close,
    isConnected: () => isConnected
  };
}

function bookApp() {
  return {
    // 言語
    currentLang: detectLanguage(),
    t: {},

    // 認証
    loggedIn: false,
    tab: "login",
    token: localStorage.getItem("token"),
    userName: "",
    loginForm: { email: "", password: "" },
    signupForm: { name: "", email: "", password: "" },
    loginError: "",
    signupError: "",

    // 本
    books: [],
    favMap: {},
    loading: false,
    searchQuery: "",
    hasSearched: false,
    showFavoritesOnly: false,
    currentPage: 1,
    totalCount: 0,
    editingId: null,
    editForm: { title: "", author: "", year: "" },
    newBook: { title: "", author: "", year: "" },

    // トースト
    toastMsg: "",
    toastError: false,
    toastVisible: false,
    _toastTimer: null,

    // チャット
    chatClient: null,
    chatConnected: false,
    chatRooms: [],
    myRoomIds: new Set(),
    currentRoomId: null,
    currentRoomMessages: [],
    typingUsers: {},
    messageInput: "",
    showChat: false,
    newRoomName: "",
    newRoomDescription: "",

    get totalPages() {
      return Math.max(1, Math.ceil(this.totalCount / PAGE_SIZE));
    },

    get showPagination() {
      return !this.loading && this.totalCount > PAGE_SIZE;
    },

    get sortedMessages() {
      return [...this.currentRoomMessages].sort((a, b) =>
        new Date(a.created_at) - new Date(b.created_at)
      );
    },

    // ===== 初期化 =====

    init() {
      this.updateTranslations();

      if (this.token) {
        const p = parseJwt(this.token);
        if (p?.exp && p.exp * 1000 > Date.now()) {
          this.userName = p.user_name || p.email || "ユーザー";
          this.loggedIn = true;
          this.loadBooks();
          this.initChat();
          return;
        }
        localStorage.removeItem("token");
        this.token = null;
      }
    },

    // ===== 言語切り替え =====

    updateTranslations() {
      this.t = i18nData[this.currentLang] || i18nData['ja'] || {};
    },

    switchLanguage(lang) {
      if (lang !== 'ja' && lang !== 'en') return;
      this.currentLang = lang;
      localStorage.setItem('language', lang);
      this.updateTranslations();
    },

    // ===== ヘルパー =====

    headers(extra = {}) {
      const h = { "Content-Type": "application/json", ...extra };
      if (this.token) h["Authorization"] = "Bearer " + this.token;
      return h;
    },

    async api(path, opts = {}) {
      const res = await fetch(API + path, {
        ...opts,
        headers: this.headers(opts.headers),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.hint || res.statusText);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    },

    toast(msg, isError = false) {
      this.toastMsg = msg;
      this.toastError = isError;
      this.toastVisible = true;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        this.toastVisible = false;
      }, 3000);
    },

    // ===== 認証 =====

    async login() {
      this.loginError = "";
      try {
        const data = await this.api("/rpc/login", {
          method: "POST",
          body: JSON.stringify(this.loginForm),
        });
        this.applyToken(data);
        this.toast("ログインしました");
      } catch (err) {
        this.loginError = err.message;
      }
    },

    async signup() {
      this.signupError = "";
      try {
        const data = await this.api("/rpc/signup", {
          method: "POST",
          body: JSON.stringify(this.signupForm),
        });
        this.applyToken(data);
        this.toast("サインアップしました");
      } catch (err) {
        this.signupError = err.message;
      }
    },

    applyToken(data) {
      const jwt = typeof data === "string" ? data : data?.token;
      if (!jwt) throw new Error("トークンを取得できませんでした");
      this.token = jwt.replace(/^"|"$/g, "");
      localStorage.setItem("token", this.token);
      const p = parseJwt(this.token);
      this.userName = p?.user_name || p?.email || "ユーザー";
      this.loggedIn = true;
      this.loadBooks();
      this.initChat();
    },

    logout() {
      if (this.chatClient) {
        this.chatClient.close();
        this.chatClient = null;
      }
      this.token = null;
      this.loggedIn = false;
      this.userName = "";
      localStorage.removeItem("token");
      this.books = [];
      this.favMap = {};
      this.chatConnected = false;
      this.chatRooms = [];
      this.currentRoomId = null;
      this.currentRoomMessages = [];
      this.typingUsers = {};
      this.messageInput = "";
      this.showChat = false;
      this.toast("ログアウトしました");
    },

    // ===== 本の一覧 =====

    async loadBooks() {
      this.loading = true;
      try {
        const offset = (this.currentPage - 1) * PAGE_SIZE;

        // お気に入り情報を取得
        const f = await this.api("/favorites");
        this.favMap = {};
        (f || []).forEach((x) => {
          this.favMap[x.book_id] = true;
        });

        let path = `/books?order=id&limit=${PAGE_SIZE}&offset=${offset}`;

        // お気に入りフィルタが有効な場合
        if (this.showFavoritesOnly) {
          const favIds = Object.keys(this.favMap);
          if (favIds.length === 0) {
            // お気に入りが1つもない場合
            this.books = [];
            this.totalCount = 0;
            this.loading = false;
            return;
          }
          path += `&id=in.(${favIds.join(",")})`;
        }

        // 検索クエリがある場合
        if (this.searchQuery) {
          const enc = encodeURIComponent("*" + this.searchQuery + "*");
          path += `&or=(title.ilike.${enc},author.ilike.${enc})`;
        }

        const res = await fetch(API + path, {
          headers: this.headers({ Prefer: "count=exact" }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || body.hint || res.statusText);
        }

        const range = res.headers.get("Content-Range");
        if (range) {
          const m = range.match(/\/(\d+|\*)/);
          this.totalCount =
            m && m[1] !== "*" ? parseInt(m[1], 10) : 0;
        } else {
          this.totalCount = 0;
        }

        this.books = (await res.json()) || [];
      } catch (err) {
        this.toast("データの取得に失敗しました: " + err.message, true);
        this.books = [];
        this.favMap = {};
        this.totalCount = 0;
      }
      this.loading = false;
    },

    // ===== CRUD =====

    async addBook() {
      const title = this.newBook.title.trim();
      const author = this.newBook.author.trim();
      if (!title || !author) return;
      try {
        const body = { title, author };
        if (this.newBook.year)
          body.published_year = parseInt(this.newBook.year, 10);
        await this.api("/books", {
          method: "POST",
          body: JSON.stringify(body),
        });
        this.newBook = { title: "", author: "", year: "" };
        await this.loadBooks();
        this.toast("本を追加しました");
      } catch (err) {
        this.toast("追加に失敗しました: " + err.message, true);
      }
    },

    startEdit(book) {
      this.editingId = book.id;
      this.editForm = {
        title: book.title,
        author: book.author,
        year: book.published_year || "",
      };
    },

    cancelEdit() {
      this.editingId = null;
    },

    async saveEdit(id) {
      const title = this.editForm.title.trim();
      const author = this.editForm.author.trim();
      if (!title || !author) {
        this.toast("タイトルと著者は必須です", true);
        return;
      }
      try {
        await this.api("/books?id=eq." + id, {
          method: "PATCH",
          body: JSON.stringify({
            title,
            author,
            published_year: this.editForm.year
              ? parseInt(this.editForm.year, 10)
              : null,
          }),
        });
        this.editingId = null;
        await this.loadBooks();
        this.toast("本を更新しました");
      } catch (err) {
        this.toast("更新に失敗しました: " + err.message, true);
      }
    },

    async deleteBook(id) {
      if (!confirm("この本を削除しますか？")) return;
      try {
        await this.api("/books?id=eq." + id, { method: "DELETE" });
        if (this.books.length === 1 && this.currentPage > 1)
          this.currentPage--;
        await this.loadBooks();
        this.toast("本を削除しました");
      } catch (err) {
        this.toast("削除に失敗しました: " + err.message, true);
      }
    },

    // ===== お気に入り =====

    async toggleFav(bookId) {
      try {
        if (this.favMap[bookId]) {
          await this.api("/favorites?book_id=eq." + bookId, {
            method: "DELETE",
          });
          delete this.favMap[bookId];
          this.toast("お気に入りを解除しました");
        } else {
          await this.api("/favorites", {
            method: "POST",
            body: JSON.stringify({ book_id: bookId }),
          });
          this.favMap[bookId] = true;
          this.toast("お気に入りに追加しました");
        }
      } catch (err) {
        this.toast(
          "お気に入りの操作に失敗しました: " + err.message,
          true,
        );
      }
    },

    // ===== 検索 =====

    doSearch() {
      if (!this.searchQuery.trim() && !this.hasSearched) return;
      this.hasSearched = !!this.searchQuery.trim();
      this.currentPage = 1;
      this.loadBooks();
    },

    clearSearch() {
      this.searchQuery = "";
      this.hasSearched = false;
      this.showFavoritesOnly = false;
      this.currentPage = 1;
      this.loadBooks();
    },

    toggleFavFilter() {
      this.showFavoritesOnly = !this.showFavoritesOnly;
      this.currentPage = 1;
      this.loadBooks();
    },

    // ===== ページング =====

    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.loadBooks();
      }
    },

    nextPage() {
      if (this.currentPage < this.totalPages) {
        this.currentPage++;
        this.loadBooks();
      }
    },

    // ===== チャット =====

    initChat() {
      if (!this.token || this.chatClient) return;

      this.chatClient = createChatClient(
        this.token,
        // onMessage
        (data) => {
          if (data.roomId === this.currentRoomId) {
            // Add message if not already present
            const exists = this.currentRoomMessages.some(m => m.id === data.message.id);
            if (!exists) {
              this.currentRoomMessages.push(data.message);
              // Auto-scroll to bottom
              this.$nextTick(() => {
                const container = document.querySelector('.chat-messages');
                if (container) container.scrollTop = container.scrollHeight;
              });
            }
          }
        },
        // onUserJoined
        (data) => {
          if (data.roomId === this.currentRoomId) {
            this.toast(`${data.user.name} が参加しました`);
          }
        },
        // onUserLeft
        (data) => {
          if (data.roomId === this.currentRoomId) {
            this.toast(`${data.user.name} が退出しました`);
          }
        },
        // onTyping
        (data) => {
          if (data.roomId === this.currentRoomId) {
            if (data.isTyping) {
              this.typingUsers[data.user.id] = data.user.name;
            } else {
              delete this.typingUsers[data.user.id];
            }
          }
        },
        // onConnected
        () => {
          this.chatConnected = true;
          this.loadChatRooms();
        },
        // onDisconnected
        () => {
          this.chatConnected = false;
        }
      );
    },

    async loadChatRooms() {
      try {
        // Load my rooms (to track membership)
        const myRooms = await this.api("/my_chat_rooms");
        this.myRoomIds = new Set((myRooms || []).map(r => r.id));

        // Load all rooms
        const allRooms = await this.api("/chat_rooms?order=created_at.desc");
        this.chatRooms = (allRooms || []).map(room => ({
          ...room,
          is_member: this.myRoomIds.has(room.id)
        }));
      } catch (err) {
        console.error("Failed to load chat rooms:", err);
      }
    },

    async createRoom() {
      const name = this.newRoomName.trim();
      if (!name) return;

      try {
        await this.api("/rpc/create_chat_room", {
          method: "POST",
          body: JSON.stringify({
            name: name,
            description: this.newRoomDescription.trim()
          }),
        });
        this.newRoomName = "";
        this.newRoomDescription = "";
        await this.loadChatRooms();
        this.toast("ルームを作成しました");
      } catch (err) {
        this.toast("ルームの作成に失敗しました: " + err.message, true);
      }
    },

    async joinRoom(roomId) {
      try {
        await this.api("/rpc/join_chat_room", {
          method: "POST",
          body: JSON.stringify({ p_room_id: roomId }),
        });
        await this.loadChatRooms();
        this.toast("ルームに参加しました");
      } catch (err) {
        this.toast("ルーム参加に失敗しました: " + err.message, true);
      }
    },

    async enterRoom(roomId) {
      // Check if user is a member
      if (!this.myRoomIds.has(roomId)) {
        this.toast("先にルームに参加してください", true);
        return;
      }

      try {
        // Load message history
        const messages = await this.api(
          `/chat_messages?room_id=eq.${roomId}&order=created_at.desc&limit=50`
        );
        this.currentRoomMessages = messages || [];
        this.currentRoomId = roomId;
        this.typingUsers = {};

        // Join via WebSocket
        if (this.chatClient) {
          this.chatClient.send({ type: "join", roomId: roomId });
        }

        // Auto-scroll to bottom
        this.$nextTick(() => {
          const container = document.querySelector('.chat-messages');
          if (container) container.scrollTop = container.scrollHeight;
        });
      } catch (err) {
        this.toast("ルームへの参加に失敗しました: " + err.message, true);
      }
    },

    sendChatMessage() {
      const message = this.messageInput.trim();
      if (!message || !this.currentRoomId || !this.chatClient) return;

      const sent = this.chatClient.send({
        type: "message",
        roomId: this.currentRoomId,
        message: message
      });

      if (sent) {
        this.messageInput = "";
        // Stop typing indicator
        this.chatClient.send({
          type: "typing",
          roomId: this.currentRoomId,
          isTyping: false
        });
      } else {
        this.toast("メッセージの送信に失敗しました", true);
      }
    },

    handleTyping() {
      if (!this.currentRoomId || !this.chatClient) return;

      const isTyping = this.messageInput.trim().length > 0;
      this.chatClient.send({
        type: "typing",
        roomId: this.currentRoomId,
        isTyping: isTyping
      });
    },

    toggleChat() {
      this.showChat = !this.showChat;
      if (this.showChat && this.chatRooms.length === 0) {
        this.loadChatRooms();
      }
    },
  };
}
