const API = "http://localhost:3000";
const PAGE_SIZE = 10;

function parseJwt(t) {
  try {
    return JSON.parse(atob(t.split(".")[1]));
  } catch {
    return null;
  }
}

function bookApp() {
  return {
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

    get totalPages() {
      return Math.max(1, Math.ceil(this.totalCount / PAGE_SIZE));
    },

    get showPagination() {
      return !this.loading && this.totalCount > PAGE_SIZE;
    },

    // ===== 初期化 =====

    init() {
      if (this.token) {
        const p = parseJwt(this.token);
        if (p?.exp && p.exp * 1000 > Date.now()) {
          this.userName = p.user_name || p.email || "ユーザー";
          this.loggedIn = true;
          this.loadBooks();
          return;
        }
        localStorage.removeItem("token");
        this.token = null;
      }
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
    },

    logout() {
      this.token = null;
      this.loggedIn = false;
      this.userName = "";
      localStorage.removeItem("token");
      this.books = [];
      this.favMap = {};
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
  };
}
