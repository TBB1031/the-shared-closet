const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const dataDir = path.join(ROOT, "data");
const uploadDir = path.join(ROOT, "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, "closet.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  size TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image_path TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS item_groups (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, group_id)
);
CREATE TABLE IF NOT EXISTS borrow_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  borrower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  message TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','declined','returned')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_items_owner ON items(owner_id);
CREATE INDEX IF NOT EXISTS idx_requests_owner ON borrow_requests(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_borrower ON borrow_requests(borrower_id, status);
`);

const SQLiteStore = SQLiteStoreFactory(session);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      return cb(new Error("Please upload a JPG, PNG, WEBP, or GIF image."));
    }
    cb(null, true);
  }
});

function apiError(res, status, message) { return res.status(status).json({ error: message }); }
function requireAuth(req, res, next) {
  if (!req.session.userId) return apiError(res, 401, "Please sign in to continue.");
  next();
}
function publicUser(id) {
  return db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(id);
}
function userGroupIds(userId) {
  return db.prepare("SELECT group_id FROM group_members WHERE user_id = ?").all(userId).map(x => x.group_id);
}
function canSeeItem(userId, itemId) {
  return !!db.prepare(`
    SELECT 1 FROM items i
    WHERE i.id = ? AND (
      i.owner_id = ? OR EXISTS (
        SELECT 1 FROM item_groups ig
        JOIN group_members gm ON gm.group_id = ig.group_id
        WHERE ig.item_id = i.id AND gm.user_id = ?
      )
    )
  `).get(itemId, userId, userId);
}
function itemStatus(itemId) {
  const active = db.prepare(`
    SELECT status FROM borrow_requests
    WHERE item_id = ? AND status IN ('pending','approved')
    ORDER BY id DESC LIMIT 1
  `).get(itemId);
  return active ? active.status : "available";
}
function itemPayload(row, viewerId) {
  const groups = db.prepare(`
    SELECT g.id, g.name FROM groups g
    JOIN item_groups ig ON ig.group_id = g.id
    WHERE ig.item_id = ? ORDER BY g.name
  `).all(row.id);
  const owner = publicUser(row.owner_id);
  return {
    id: row.id, name: row.name, category: row.category, size: row.size,
    description: row.description, imageUrl: row.image_path ? `/uploads/${path.basename(row.image_path)}` : "",
    ownerId: row.owner_id, ownerName: owner?.name || "Member",
    isOwner: row.owner_id === viewerId, groups, status: itemStatus(row.id)
  };
}
function makeInviteCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60);
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2) return apiError(res, 400, "Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError(res, 400, "Enter a valid email address.");
  if (password.length < 10) return apiError(res, 400, "Use a password with at least 10 characters.");
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)").run(name, email, hash);
    req.session.userId = Number(result.lastInsertRowid);
    res.json({ user: publicUser(req.session.userId) });
  } catch (err) {
    if (String(err.code).includes("SQLITE_CONSTRAINT")) return apiError(res, 409, "An account with that email already exists.");
    throw err;
  }
});
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return apiError(res, 401, "Email or password is incorrect.");
  req.session.userId = user.id;
  res.json({ user: publicUser(user.id) });
});
app.post("/api/auth/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get("/api/me", requireAuth, (req, res) => res.json({ user: publicUser(req.session.userId) }));

app.get("/api/groups", requireAuth, (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.invite_code AS inviteCode,
      (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS memberCount
    FROM groups g JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ? ORDER BY g.created_at DESC
  `).all(req.session.userId);
  res.json({ groups });
});
app.post("/api/groups", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60);
  if (name.length < 2) return apiError(res, 400, "Group names need at least 2 characters.");
  let code = makeInviteCode();
  while (db.prepare("SELECT 1 FROM groups WHERE invite_code = ?").get(code)) code = makeInviteCode();
  const create = db.transaction(() => {
    const result = db.prepare("INSERT INTO groups (name,invite_code,created_by) VALUES (?,?,?)").run(name, code, req.session.userId);
    db.prepare("INSERT INTO group_members (group_id,user_id) VALUES (?,?)").run(result.lastInsertRowid, req.session.userId);
    return Number(result.lastInsertRowid);
  });
  const id = create();
  res.json({ group: db.prepare("SELECT id,name,invite_code AS inviteCode FROM groups WHERE id = ?").get(id) });
});
app.post("/api/groups/join", requireAuth, (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const group = db.prepare("SELECT id,name FROM groups WHERE invite_code = ?").get(code);
  if (!group) return apiError(res, 404, "That invite code wasn't found.");
  db.prepare("INSERT OR IGNORE INTO group_members (group_id,user_id) VALUES (?,?)").run(group.id, req.session.userId);
  res.json({ group });
});
app.get("/api/groups/:id/members", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const member = db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?").get(id, req.session.userId);
  if (!member) return apiError(res, 404, "Group not found.");
  const members = db.prepare(`
    SELECT u.id,u.name FROM users u JOIN group_members gm ON gm.user_id=u.id
    WHERE gm.group_id=? ORDER BY u.name
  `).all(id);
  res.json({ members });
});

app.get("/api/items", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT i.* FROM items i
    LEFT JOIN item_groups ig ON ig.item_id=i.id
    LEFT JOIN group_members gm ON gm.group_id=ig.group_id
    WHERE i.owner_id=? OR gm.user_id=?
    ORDER BY i.created_at DESC
  `).all(req.session.userId, req.session.userId);
  res.json({ items: rows.map(row => itemPayload(row, req.session.userId)) });
});
app.post("/api/items", requireAuth, upload.single("photo"), (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 80);
  const category = String(req.body.category || "Other").trim().slice(0, 40);
  const size = String(req.body.size || "").trim().slice(0, 30);
  const description = String(req.body.description || "").trim().slice(0, 500);
  if (name.length < 2) {
    if (req.file) fs.unlinkSync(req.file.path);
    return apiError(res, 400, "Give your item a name.");
  }
  let groupIds = [];
  try { groupIds = JSON.parse(req.body.groupIds || "[]").map(Number); } catch { groupIds = []; }
  groupIds = [...new Set(groupIds.filter(Number.isInteger))];
  const allowed = groupIds.length ? db.prepare(`
    SELECT group_id FROM group_members WHERE user_id=? AND group_id IN (${groupIds.map(() => "?").join(",")})
  `).all(req.session.userId, ...groupIds).map(x => x.group_id) : [];
  if (allowed.length !== groupIds.length) {
    if (req.file) fs.unlinkSync(req.file.path);
    return apiError(res, 403, "You can only share items with groups you belong to.");
  }
  const create = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO items (owner_id,name,category,size,description,image_path) VALUES (?,?,?,?,?,?)
    `).run(req.session.userId, name, category, size, description, req.file ? req.file.path : "");
    const id = Number(result.lastInsertRowid);
    const addGroup = db.prepare("INSERT INTO item_groups (item_id,group_id) VALUES (?,?)");
    for (const groupId of allowed) addGroup.run(id, groupId);
    return id;
  });
  const id = create();
  const row = db.prepare("SELECT * FROM items WHERE id=?").get(id);
  res.json({ item: itemPayload(row, req.session.userId) });
});
app.delete("/api/items/:id", requireAuth, (req, res) => {
  const item = db.prepare("SELECT * FROM items WHERE id=? AND owner_id=?").get(Number(req.params.id), req.session.userId);
  if (!item) return apiError(res, 404, "Item not found.");
  const active = db.prepare("SELECT 1 FROM borrow_requests WHERE item_id=? AND status IN ('pending','approved')").get(item.id);
  if (active) return apiError(res, 409, "Resolve active borrowing requests before deleting this item.");
  db.prepare("DELETE FROM items WHERE id=?").run(item.id);
  if (item.image_path && fs.existsSync(item.image_path)) fs.unlinkSync(item.image_path);
  res.json({ ok: true });
});

app.get("/api/requests", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT br.*, i.name AS item_name, i.image_path, borrower.name AS borrower_name, owner.name AS owner_name
    FROM borrow_requests br
    JOIN items i ON i.id=br.item_id
    JOIN users borrower ON borrower.id=br.borrower_id
    JOIN users owner ON owner.id=br.owner_id
    WHERE br.owner_id=? OR br.borrower_id=?
    ORDER BY br.created_at DESC
  `).all(req.session.userId, req.session.userId);
  res.json({ requests: rows.map(r => ({
    id:r.id, itemId:r.item_id, itemName:r.item_name,
    imageUrl:r.image_path ? `/uploads/${path.basename(r.image_path)}` : "",
    borrowerId:r.borrower_id, borrowerName:r.borrower_name,
    ownerId:r.owner_id, ownerName:r.owner_name,
    startDate:r.start_date, endDate:r.end_date, message:r.message,
    status:r.status, isOwner:r.owner_id===req.session.userId
  })) });
});
app.post("/api/requests", requireAuth, (req, res) => {
  const itemId = Number(req.body.itemId);
  const startDate = String(req.body.startDate || "");
  const endDate = String(req.body.endDate || "");
  const message = String(req.body.message || "").trim().slice(0, 300);
  const item = db.prepare("SELECT * FROM items WHERE id=?").get(itemId);
  if (!item || item.owner_id === req.session.userId || !canSeeItem(req.session.userId, itemId)) return apiError(res, 404, "That item isn't available to request.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return apiError(res, 400, "Choose a valid borrowing date range.");
  if (itemStatus(itemId) !== "available") return apiError(res, 409, "This item already has an active request or loan.");
  const result = db.prepare(`
    INSERT INTO borrow_requests (item_id,borrower_id,owner_id,start_date,end_date,message)
    VALUES (?,?,?,?,?,?)
  `).run(itemId, req.session.userId, item.owner_id, startDate, endDate, message);
  res.json({ id: Number(result.lastInsertRowid) });
});
app.post("/api/requests/:id/decision", requireAuth, (req, res) => {
  const decision = req.body.decision;
  if (!["approved","declined"].includes(decision)) return apiError(res, 400, "Invalid decision.");
  const request = db.prepare("SELECT * FROM borrow_requests WHERE id=? AND owner_id=?").get(Number(req.params.id), req.session.userId);
  if (!request || request.status !== "pending") return apiError(res, 404, "Pending request not found.");
  if (decision === "approved" && itemStatus(request.item_id) !== "pending") return apiError(res, 409, "This item is no longer available.");
  db.prepare("UPDATE borrow_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(decision, request.id);
  res.json({ ok: true });
});
app.post("/api/requests/:id/return", requireAuth, (req, res) => {
  const request = db.prepare(`
    SELECT * FROM borrow_requests WHERE id=? AND status='approved'
      AND (owner_id=? OR borrower_id=?)
  `).get(Number(req.params.id), req.session.userId, req.session.userId);
  if (!request) return apiError(res, 404, "Active loan not found.");
  db.prepare("UPDATE borrow_requests SET status='returned',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(request.id);
  res.json({ ok: true });
});

app.use("/uploads", express.static(uploadDir, { maxAge: "1d" }));
app.use(express.static(path.join(ROOT, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return apiError(res, 400, "Images must be 8 MB or smaller.");
  return apiError(res, 400, err.message || "Something went wrong.");
});

app.listen(PORT, () => console.log(`The Shared Closet is running at http://localhost:${PORT}`));
