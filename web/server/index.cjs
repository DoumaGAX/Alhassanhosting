const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const { DatabaseSync } = require("node:sqlite");

const app = express();
app.use(express.json());

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "alhassan.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    passwordHash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ownerId INTEGER NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    software TEXT NOT NULL,
    version TEXT NOT NULL,
    ram TEXT NOT NULL,
    online INTEGER NOT NULL DEFAULT 0,
    autoUpdateBedrock INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
  );
`);

app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "alhassan-local-dev-secret-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

app.get("/api/health", (req, res) => {
  res.json({ name: "Alhassan Hosting", status: "online" });
});

app.get("/api/versions", async (req, res) => {
  try {
    const response = await fetch(
      "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
    );
    if (!response.ok) throw new Error("Could not fetch versions");
    const data = await response.json();

    res.json({
      java: data.versions
        .filter((version) => version.type === "release")
        .map((version) => version.id),
      source: "Mojang"
    });
  } catch {
    res.status(502).json({ error: "Could not load Minecraft versions" });
  }
});

function publicUser(user) {
  return { id: user.id, username: user.username };
}

function publicServer(server) {
  return {
    id: server.id,
    name: server.name,
    platform: server.platform,
    software: server.software,
    version: server.version,
    ram: server.ram,
    online: Boolean(server.online),
    autoUpdateBedrock: Boolean(server.autoUpdateBedrock)
  };
}

function getOwnedServer(id, ownerId) {
  return db.prepare(
    "SELECT * FROM servers WHERE id = ? AND ownerId = ?"
  ).get(id, ownerId);
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const username =
      typeof req.body.username === "string" ? req.body.username.trim() : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        error: "Username must be 3-20 letters, numbers or underscores"
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: "Password must be 8-128 characters"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let result;

    try {
      result = db.prepare(
        "INSERT INTO users (username, passwordHash) VALUES (?, ?)"
      ).run(username, passwordHash);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ error: "Username already exists" });
      }
      throw error;
    }

    const user = { id: Number(result.lastInsertRowid), username };

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({
          error: "Account created, but session could not start. Please log in."
        });
      }

      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          return res.status(500).json({
            error: "Account created, but session could not be saved. Please log in."
          });
        }
        res.status(201).json(user);
      });
    });
  } catch {
    res.status(500).json({ error: "Could not register account" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username =
      typeof req.body.username === "string" ? req.body.username.trim() : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    const user = db.prepare(
      "SELECT * FROM users WHERE username = ? COLLATE NOCASE"
    ).get(username);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Could not start session" });

      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "Could not save session" });
        res.json(publicUser(user));
      });
    });
  } catch {
    res.status(500).json({ error: "Could not log in" });
  }
});

app.get("/api/auth/me", (req, res) => {
  const user = db.prepare(
    "SELECT id, username FROM users WHERE id = ?"
  ).get(req.session.userId);

  if (!user) return res.status(401).json({ error: "Not logged in" });
  res.json(user);
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Could not log out" });
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

function requireLogin(req, res, next) {
  const user = db.prepare(
    "SELECT id FROM users WHERE id = ?"
  ).get(req.session.userId);

  if (!user) return res.status(401).json({ error: "Please log in first" });
  next();
}

app.get("/api/servers", requireLogin, (req, res) => {
  const servers = db.prepare(
    "SELECT * FROM servers WHERE ownerId = ? ORDER BY id DESC"
  ).all(req.session.userId);
  res.json(servers.map(publicServer));
});

app.post("/api/servers", requireLogin, (req, res) => {
  const { name, platform, software, version, ram, autoUpdateBedrock } = req.body;

  if (
    typeof name !== "string" || !name.trim() ||
    typeof platform !== "string" ||
    typeof software !== "string" ||
    typeof version !== "string" ||
    typeof ram !== "string"
  ) {
    return res.status(400).json({ error: "Missing or invalid server settings" });
  }

  try {
    const result = db.prepare(`
      INSERT INTO servers
      (ownerId, name, platform, software, version, ram, online, autoUpdateBedrock)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      req.session.userId,
      name.trim(),
      platform,
      software,
      version,
      ram,
      autoUpdateBedrock ? 1 : 0
    );

    const server = getOwnedServer(Number(result.lastInsertRowid), req.session.userId);
    res.status(201).json(publicServer(server));
  } catch {
    res.status(500).json({ error: "Could not create server" });
  }
});

app.delete("/api/servers/:id", requireLogin, (req, res) => {
  const result = db.prepare(
    "DELETE FROM servers WHERE id = ? AND ownerId = ?"
  ).run(req.params.id, req.session.userId);

  if (!result.changes) return res.status(404).json({ error: "Server not found" });
  res.json({ success: true });
});

const minecraftDir = path.join(
  process.env.USERPROFILE || process.env.HOME || __dirname,
  "AlhassanHosting-Servers",
  "server1"
);

let minecraftProcess = null;

app.patch("/api/servers/:id", requireLogin, (req, res) => {
  const server = getOwnedServer(req.params.id, req.session.userId);
  if (!server) return res.status(404).json({ error: "Server not found" });

  if (typeof req.body.online !== "boolean") {
    return res.status(400).json({ error: "Invalid server state" });
  }

  if (req.body.online) {
    if (minecraftProcess && minecraftProcess.exitCode === null) {
      return res.status(409).json({ error: "A Minecraft server is already running." });
    }

    if (!fs.existsSync(path.join(minecraftDir, "server.jar"))) {
      return res.status(500).json({
        error: "server.jar was not found in the configured server folder."
      });
    }

    try {
      const child = spawn(
        "java",
        ["-Xms1G", "-Xmx2G", "-jar", "server.jar", "nogui"],
        {
          cwd: minecraftDir,
          windowsHide: true,
          stdio: ["pipe", "ignore", "pipe"]
        }
      );

      minecraftProcess = child;
      child.once("error", () => {
        if (minecraftProcess === child) minecraftProcess = null;
      });
      child.once("exit", () => {
        if (minecraftProcess === child) minecraftProcess = null;
      });

      db.prepare(
        "UPDATE servers SET online = 1 WHERE id = ? AND ownerId = ?"
      ).run(server.id, req.session.userId);

      return res.json({ ...publicServer(server), online: true });
    } catch {
      return res.status(500).json({ error: "Could not start Minecraft server." });
    }
  }

  if (minecraftProcess && minecraftProcess.exitCode === null) {
    const child = minecraftProcess;
    try {
      child.stdin.write("stop\n");
    } catch {
      return res.status(500).json({ error: "Could not send stop command." });
    }
  }

  db.prepare(
    "UPDATE servers SET online = 0 WHERE id = ? AND ownerId = ?"
  ).run(server.id, req.session.userId);

  res.json({ ...publicServer(server), online: false });
});

const PORT = Number(process.env.PORT) || 3001;
const HOST = "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  console.log(`Alhassan Hosting API listening on ${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => {
    try {
      if (minecraftProcess && minecraftProcess.exitCode === null) {
        minecraftProcess.stdin.write("stop\n");
      }
    } catch {}
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
