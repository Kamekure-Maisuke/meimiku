import { WebSocketServer } from "ws";
import { Pool } from "pg";
import crypto from "crypto";

// Configuration
const WS_PORT = process.env.WS_PORT || 3001;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://meimiku:meimiku@localhost:5432/meimiku";
const JWT_SECRET =
  process.env.JWT_SECRET || "my-super-secret-jwt-key-for-meimiku-2024";

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
});

// WebSocket server
const wss = new WebSocketServer({ port: WS_PORT });

// Connection tracking
// clients: Map<userId, Set<WebSocket>>
const clients = new Map();
// roomMembers: Map<roomId, Set<userId>>
const roomMembers = new Map();

console.log(`WebSocket server listening on port ${WS_PORT}`);

// ============================================================
// JWT Verification (HMAC-SHA256)
// ============================================================

function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad) str += "=".repeat(4 - pad);
  return Buffer.from(str, "base64").toString("utf8");
}

function verifyJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const message = `${headerB64}.${payloadB64}`;
    const signature = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(message)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    if (signature !== signatureB64) {
      console.log("JWT signature verification failed");
      return null;
    }

    // Parse payload
    const payload = JSON.parse(base64UrlDecode(payloadB64));

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.log("JWT expired");
      return null;
    }

    return payload;
  } catch (err) {
    console.error("JWT verification error:", err);
    return null;
  }
}

// ============================================================
// Database Helpers
// ============================================================

async function isUserInRoom(userId, roomId) {
  try {
    const result = await pool.query(
      "SELECT 1 FROM api.room_members WHERE user_id = $1 AND room_id = $2",
      [userId, roomId],
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error("Database error checking room membership:", err);
    return false;
  }
}

async function saveMessage(roomId, userId, message) {
  try {
    const result = await pool.query(
      "INSERT INTO api.chat_messages (room_id, user_id, message) VALUES ($1, $2, $3) RETURNING id, created_at",
      [roomId, userId, message],
    );
    return result.rows[0];
  } catch (err) {
    console.error("Database error saving message:", err);
    return null;
  }
}

async function getUserInfo(userId) {
  try {
    const result = await pool.query(
      "SELECT id, name, email FROM api.users WHERE id = $1",
      [userId],
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Database error getting user info:", err);
    return null;
  }
}

// ============================================================
// Connection Management
// ============================================================

function addClient(userId, ws) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId).add(ws);
}

function removeClient(userId, ws) {
  const userClients = clients.get(userId);
  if (userClients) {
    userClients.delete(ws);
    if (userClients.size === 0) {
      clients.delete(userId);
    }
  }
}

function addRoomMember(roomId, userId) {
  if (!roomMembers.has(roomId)) {
    roomMembers.set(roomId, new Set());
  }
  roomMembers.get(roomId).add(userId);
}

function removeRoomMember(roomId, userId) {
  const members = roomMembers.get(roomId);
  if (members) {
    members.delete(userId);
    if (members.size === 0) {
      roomMembers.delete(roomId);
    }
  }
}

function broadcastToRoom(roomId, message, excludeUserId = null) {
  const members = roomMembers.get(roomId);
  if (!members) return;

  const messageStr = JSON.stringify(message);

  members.forEach((userId) => {
    if (userId === excludeUserId) return;

    const userClients = clients.get(userId);
    if (userClients) {
      userClients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(messageStr);
        }
      });
    }
  });
}

function sendToUser(userId, message) {
  const userClients = clients.get(userId);
  if (!userClients) return;

  const messageStr = JSON.stringify(message);

  userClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(messageStr);
    }
  });
}

// ============================================================
// WebSocket Connection Handler
// ============================================================

wss.on("connection", (ws) => {
  let userId = null;
  let userInfo = null;
  const joinedRooms = new Set();

  console.log("New WebSocket connection");

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // ========== Authentication ==========
      if (msg.type === "auth") {
        if (!msg.token) {
          ws.send(JSON.stringify({ type: "error", message: "Token required" }));
          return;
        }

        const payload = verifyJWT(msg.token);
        if (!payload || !payload.user_id) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid token" }));
          ws.close();
          return;
        }

        userId = payload.user_id;
        userInfo = await getUserInfo(userId);

        if (!userInfo) {
          ws.send(JSON.stringify({ type: "error", message: "User not found" }));
          ws.close();
          return;
        }

        addClient(userId, ws);

        ws.send(
          JSON.stringify({
            type: "authenticated",
            user: {
              id: userInfo.id,
              name: userInfo.name,
              email: userInfo.email,
            },
          }),
        );

        console.log(`User ${userId} (${userInfo.name}) authenticated`);
        return;
      }

      // Check authentication for all other message types
      if (!userId || !userInfo) {
        ws.send(
          JSON.stringify({ type: "error", message: "Not authenticated" }),
        );
        return;
      }

      // ========== Join Room ==========
      if (msg.type === "join") {
        const roomId = parseInt(msg.roomId);
        if (!roomId || isNaN(roomId)) {
          ws.send(
            JSON.stringify({ type: "error", message: "Invalid room ID" }),
          );
          return;
        }

        // Check if user is a member of this room
        const isMember = await isUserInRoom(userId, roomId);
        if (!isMember) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Not a member of this room",
            }),
          );
          return;
        }

        addRoomMember(roomId, userId);
        joinedRooms.add(roomId);

        ws.send(
          JSON.stringify({
            type: "joined",
            roomId: roomId,
          }),
        );

        // Notify other room members
        broadcastToRoom(
          roomId,
          {
            type: "user_joined",
            roomId: roomId,
            user: { id: userInfo.id, name: userInfo.name },
          },
          userId,
        );

        console.log(`User ${userId} (${userInfo.name}) joined room ${roomId}`);
        return;
      }

      // ========== Send Message ==========
      if (msg.type === "message") {
        const roomId = parseInt(msg.roomId);
        const messageText = msg.message?.trim();

        if (!roomId || isNaN(roomId)) {
          ws.send(
            JSON.stringify({ type: "error", message: "Invalid room ID" }),
          );
          return;
        }

        if (
          !messageText ||
          messageText.length === 0 ||
          messageText.length > 5000
        ) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Invalid message length",
            }),
          );
          return;
        }

        // Check if user is in the room
        if (!joinedRooms.has(roomId)) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Not joined to this room",
            }),
          );
          return;
        }

        // Save message to database
        const saved = await saveMessage(roomId, userId, messageText);
        if (!saved) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Failed to save message",
            }),
          );
          return;
        }

        // Broadcast message to all room members (including sender)
        const messageData = {
          type: "message",
          roomId: roomId,
          message: {
            id: saved.id,
            user_id: userId,
            user_name: userInfo.name,
            message: messageText,
            created_at: saved.created_at,
          },
        };

        broadcastToRoom(roomId, messageData);
        sendToUser(userId, messageData);

        console.log(`User ${userId} sent message to room ${roomId}`);
        return;
      }

      // ========== Typing Indicator ==========
      if (msg.type === "typing") {
        const roomId = parseInt(msg.roomId);
        const isTyping = msg.isTyping === true;

        if (!roomId || isNaN(roomId)) {
          return;
        }

        if (!joinedRooms.has(roomId)) {
          return;
        }

        // Broadcast typing status to other room members
        broadcastToRoom(
          roomId,
          {
            type: "typing",
            roomId: roomId,
            user: { id: userInfo.id, name: userInfo.name },
            isTyping: isTyping,
          },
          userId,
        );

        return;
      }

      // Unknown message type
      ws.send(
        JSON.stringify({ type: "error", message: "Unknown message type" }),
      );
    } catch (err) {
      console.error("Error handling message:", err);
      ws.send(
        JSON.stringify({ type: "error", message: "Internal server error" }),
      );
    }
  });

  ws.on("close", () => {
    if (userId) {
      removeClient(userId, ws);

      // Remove from all joined rooms and notify
      joinedRooms.forEach((roomId) => {
        removeRoomMember(roomId, userId);

        if (userInfo) {
          broadcastToRoom(roomId, {
            type: "user_left",
            roomId: roomId,
            user: { id: userInfo.id, name: userInfo.name },
          });
        }
      });

      console.log(`User ${userId} disconnected`);
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing connections...");
  wss.close(() => {
    pool.end(() => {
      console.log("Server shut down");
      process.exit(0);
    });
  });
});
