const API = "http://localhost:3000";
let token = localStorage.getItem("token");
let currentUser = null;
let books = [];
let favorites = new Set();
let editingId = null;
let currentPage = 1;
let totalCount = 0;
const PAGE_SIZE = 10;

// ===== ヘルパー =====

const $ = (s) => document.getElementById(s) || document.querySelector(s);

function headers(extra = {}) {
  const h = { "Content-Type": "application/json", ...extra };
  if (token) h["Authorization"] = "Bearer " + token;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: headers(opts.headers),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.hint || res.statusText);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function toast(msg, isError = false) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => (el.className = "toast"), 3000);
}

function parseJwt(t) {
  try {
    return JSON.parse(atob(t.split(".")[1]));
  } catch {
    return null;
  }
}

function esc(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ===== 画面切り替え =====

function showAuth() {
  $("auth-screen").style.display = "flex";
  $("main-screen").style.display = "none";
}

function showMain() {
  $("auth-screen").style.display = "none";
  $("main-screen").style.display = "block";
  const p = parseJwt(token);
  if (p) {
    currentUser = p;
    $("user-info").textContent =
      (p.user_name || p.email || "ユーザー") + " でログイン中";
  }
  loadBooks();
}

// ===== 認証（共通） =====

function extractToken(data) {
  const jwt = typeof data === "string" ? data : data?.token;
  if (!jwt) throw new Error("トークンを取得できませんでした");
  return jwt.replace(/^"|"$/g, "");
}

async function authenticate(endpoint, body, errElId) {
  const errEl = $(errElId);
  errEl.style.display = "none";
  try {
    const data = await api("/rpc/" + endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
    token = extractToken(data);
    localStorage.setItem("token", token);
    toast(endpoint === "login" ? "ログインしました" : "サインアップしました");
    showMain();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = "block";
  }
}

// ===== タブ切り替え =====

document.querySelectorAll(".tab-bar button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tab-bar button")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document
      .querySelectorAll(".auth-form")
      .forEach((f) => f.classList.remove("active"));
    $(btn.dataset.tab + "-form").classList.add("active");
  });
});

// ===== 認証フォーム =====

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  authenticate(
    "login",
    {
      email: $("login-email").value.trim(),
      password: $("login-password").value,
    },
    "login-error",
  );
});

$("signup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  authenticate(
    "signup",
    {
      name: $("signup-name").value.trim(),
      email: $("signup-email").value.trim(),
      password: $("signup-password").value,
    },
    "signup-error",
  );
});

$("btn-logout").addEventListener("click", () => {
  token = null;
  currentUser = null;
  localStorage.removeItem("token");
  books = [];
  favorites = new Set();
  toast("ログアウトしました");
  showAuth();
});

// ===== 本の一覧 =====

async function loadBooks(query = "") {
  $("books-loading").style.display = "block";
  $("books-table").style.display = "none";
  $("books-empty").style.display = "none";

  try {
    const offset = (currentPage - 1) * PAGE_SIZE;
    let booksPath = `/books?order=id&limit=${PAGE_SIZE}&offset=${offset}`;
    if (query) {
      const encoded = encodeURIComponent("*" + query + "*");
      booksPath += `&or=(title.ilike.${encoded},author.ilike.${encoded})`;
    }

    const booksRes = fetch(API + booksPath, {
      headers: headers({ Prefer: "count=exact" }),
    });
    const favsRes = api("/favorites");

    const [res, f] = await Promise.all([booksRes, favsRes]);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.hint || res.statusText);
    }

    const range = res.headers.get("Content-Range");
    if (range) {
      const match = range.match(/\/(\d+|\*)/);
      totalCount = match && match[1] !== "*" ? parseInt(match[1], 10) : 0;
    } else {
      totalCount = 0;
    }

    books = (await res.json()) || [];
    favorites = new Set((f || []).map((x) => x.book_id));
  } catch (err) {
    toast("データの取得に失敗しました: " + err.message, true);
    books = [];
    favorites = new Set();
    totalCount = 0;
  }

  $("books-loading").style.display = "none";
  if (books.length === 0 && totalCount === 0) {
    $("books-empty").style.display = "block";
  } else {
    $("books-table").style.display = "table";
    renderBooks();
  }
  renderPagination();
}

// ===== 本の描画 =====

function renderBooks() {
  const tbody = $("books-body");

  if (books.length === 0) {
    $("books-table").style.display = "none";
    $("books-empty").style.display = "block";
    return;
  }
  $("books-table").style.display = "table";
  $("books-empty").style.display = "none";

  tbody.innerHTML = books
    .map((b) => {
      const fav = favorites.has(b.id);
      if (editingId === b.id) {
        return `<tr>
                <td><input class="edit-input" data-field="title" value="${esc(b.title)}"></td>
                <td><input class="edit-input" data-field="author" value="${esc(b.author)}"></td>
                <td><input class="edit-input" data-field="year" type="number" value="${b.published_year || ""}"></td>
                <td class="actions">
                    <button class="btn-icon btn-save" data-action="save" data-id="${b.id}" title="保存">&#10003;</button>
                    <button class="btn-icon btn-cancel" data-action="cancel" title="キャンセル">&#10007;</button>
                </td>
            </tr>`;
      }
      return `<tr>
            <td>${esc(b.title)}</td>
            <td>${esc(b.author)}</td>
            <td>${b.published_year || "—"}</td>
            <td class="actions">
                <button class="btn-icon btn-fav ${fav ? "active" : ""}" data-action="fav" data-id="${b.id}" title="お気に入り">${fav ? "&#9829;" : "&#9825;"}</button>
                <button class="btn-icon btn-edit" data-action="edit" data-id="${b.id}" title="編集">&#9998;</button>
                <button class="btn-icon btn-delete" data-action="delete" data-id="${b.id}" title="削除">&#128465;</button>
            </td>
        </tr>`;
    })
    .join("");
}

// ===== ページング描画 =====

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const controls = $("pagination-controls");

  if (totalCount <= PAGE_SIZE) {
    controls.style.display = "none";
    return;
  }

  controls.style.display = "flex";
  $("page-info").textContent = `${currentPage} / ${totalPages}`;
  $("btn-prev").disabled = currentPage <= 1;
  $("btn-next").disabled = currentPage >= totalPages;
}

// ===== イベント委譲（テーブル操作） =====

$("books-body").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = Number(btn.dataset.id);

  if (action === "edit") {
    editingId = id;
    renderBooks();
  } else if (action === "cancel") {
    editingId = null;
    renderBooks();
  } else if (action === "save") await saveEdit(id);
  else if (action === "delete") await deleteBook(id);
  else if (action === "fav") await toggleFav(id);
});

// ===== 本を追加 =====

$("add-book-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("new-title").value.trim();
  const author = $("new-author").value.trim();
  const year = $("new-year").value;
  if (!title || !author) return;

  try {
    const body = { title, author };
    if (year) body.published_year = parseInt(year, 10);
    await api("/books", {
      method: "POST",
      body: JSON.stringify(body),
    });
    await loadBooks($("search-query").value.trim());
    toast("本を追加しました");
    e.target.reset();
  } catch (err) {
    toast("追加に失敗しました: " + err.message, true);
  }
});

// ===== 本を編集 =====

async function saveEdit(id) {
  const row = $("books-body")
    .querySelector(`[data-action="save"][data-id="${id}"]`)
    .closest("tr");
  const title = row.querySelector('[data-field="title"]').value.trim();
  const author = row.querySelector('[data-field="author"]').value.trim();
  const year = row.querySelector('[data-field="year"]').value;

  if (!title || !author) {
    toast("タイトルと著者は必須です", true);
    return;
  }

  try {
    await api("/books?id=eq." + id, {
      method: "PATCH",
      body: JSON.stringify({
        title,
        author,
        published_year: year ? parseInt(year, 10) : null,
      }),
    });
    editingId = null;
    await loadBooks($("search-query").value.trim());
    toast("本を更新しました");
  } catch (err) {
    toast("更新に失敗しました: " + err.message, true);
  }
}

// ===== 本を削除 =====

async function deleteBook(id) {
  if (!confirm("この本を削除しますか？")) return;
  try {
    await api("/books?id=eq." + id, { method: "DELETE" });
    if (books.length === 1 && currentPage > 1) currentPage--;
    await loadBooks($("search-query").value.trim());
    toast("本を削除しました");
  } catch (err) {
    toast("削除に失敗しました: " + err.message, true);
  }
}

// ===== お気に入り =====

async function toggleFav(bookId) {
  try {
    if (favorites.has(bookId)) {
      await api("/favorites?book_id=eq." + bookId, { method: "DELETE" });
      favorites.delete(bookId);
      toast("お気に入りを解除しました");
    } else {
      await api("/favorites", {
        method: "POST",
        body: JSON.stringify({ book_id: bookId }),
      });
      favorites.add(bookId);
      toast("お気に入りに追加しました");
    }
    renderBooks();
  } catch (err) {
    toast("お気に入りの操作に失敗しました: " + err.message, true);
  }
}

// ===== 検索 =====

let hasSearched = false;

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const query = $("search-query").value.trim();
  if (!query && !hasSearched) return;
  hasSearched = !!query;
  currentPage = 1;
  loadBooks(query);
});

$("search-clear").addEventListener("click", () => {
  $("search-query").value = "";
  hasSearched = false;
  currentPage = 1;
  loadBooks();
});

// ===== ページング操作 =====

$("btn-prev").addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    loadBooks($("search-query").value.trim());
  }
});

$("btn-next").addEventListener("click", () => {
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  if (currentPage < totalPages) {
    currentPage++;
    loadBooks($("search-query").value.trim());
  }
});

// ===== 初期化 =====

(function init() {
  if (token) {
    const p = parseJwt(token);
    if (p?.exp && p.exp * 1000 > Date.now()) {
      showMain();
      return;
    }
    localStorage.removeItem("token");
    token = null;
  }
  showAuth();
})();
