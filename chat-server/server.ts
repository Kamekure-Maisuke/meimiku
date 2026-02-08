import { Pool } from "@db/postgres";

const WS_PORT = Deno.env.get("WS_PORT") || "3001";
const DATABASE_URL =
  Deno.env.get("DATABASE_URL") ||
  "postgres://meimiku:meimiku@localhost:5432/meimiku";
const JWT_SECRET =
  Deno.env.get("JWT_SECRET") || "my-super-secret-jwt-key-for-meimiku-2024";

const pool = new Pool(DATABASE_URL, 10);
const clients = new Map<number, Set<WebSocket>>();
const roomMembers = new Map<number, Set<number>>();

// Helper: Database query with auto connection management
async function query<T>(sql: string, params: unknown[]) {
  const client = await pool.connect();
  try {
    return await client.queryObject<T>(sql, params);
  } finally {
    client.release();
  }
}

// Helper: Manage Map<K, Set<V>>
function addToSet<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(value);
}

function removeFromSet<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const set = map.get(key);
  if (set) {
    set.delete(value);
    if (set.size === 0) map.delete(key);
  }
}

// Helper: Send JSON message
function send(ws: WebSocket, type: string, data: Record<string, unknown> = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

// JWT verification
async function verifyJWT(token: string) {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(
        atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0),
      ),
      encoder.encode(`${headerB64}.${payloadB64}`),
    );

    if (!isValid) return null;

    const payload = JSON.parse(
      atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (payload.exp && payload.exp < Date.now() / 1000) return null;

    return payload;
  } catch {
    return null;
  }
}

// Broadcast to room members
function broadcast(roomId: number, message: unknown, excludeUserId?: number) {
  const members = roomMembers.get(roomId);
  if (!members) return;

  const str = JSON.stringify(message);
  members.forEach((userId) => {
    if (userId === excludeUserId) return;
    clients.get(userId)?.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(str);
    });
  });
}

// WebSocket handler
function handleWebSocket(ws: WebSocket) {
  let userId: number | null = null;
  let userName = "";
  const joinedRooms = new Set<number>();

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      // Auth
      if (msg.type === "auth") {
        const payload = await verifyJWT(msg.token);
        if (!payload?.user_id) {
          send(ws, "error", { message: "Invalid token" });
          return ws.close();
        }

        const user = await query<{ id: number; name: string; email: string }>(
          "SELECT id, name, email FROM api.users WHERE id = $1",
          [payload.user_id],
        );

        if (!user.rows[0]) {
          send(ws, "error", { message: "User not found" });
          return ws.close();
        }

        userId = user.rows[0].id;
        userName = user.rows[0].name;
        addToSet(clients, userId, ws);
        send(ws, "authenticated", { user: user.rows[0] });
        return;
      }

      // Require auth
      if (!userId) {
        send(ws, "error", { message: "Not authenticated" });
        return;
      }

      // Join room
      if (msg.type === "join") {
        const roomId = parseInt(msg.roomId);
        if (!roomId || isNaN(roomId))
          return send(ws, "error", { message: "Invalid room ID" });

        const membership = await query(
          "SELECT 1 FROM api.room_members WHERE user_id = $1 AND room_id = $2",
          [userId, roomId],
        );

        if (membership.rows.length === 0) {
          return send(ws, "error", { message: "Not a member of this room" });
        }

        addToSet(roomMembers, roomId, userId);
        joinedRooms.add(roomId);
        send(ws, "joined", { roomId });
        broadcast(
          roomId,
          { type: "user_joined", roomId, user: { id: userId, name: userName } },
          userId,
        );
        return;
      }

      // Send message
      if (msg.type === "message") {
        const roomId = parseInt(msg.roomId);
        const text = msg.message?.trim();

        if (!roomId || isNaN(roomId))
          return send(ws, "error", { message: "Invalid room ID" });
        if (!text || text.length === 0 || text.length > 5000) {
          return send(ws, "error", { message: "Invalid message length" });
        }
        if (!joinedRooms.has(roomId)) {
          return send(ws, "error", { message: "Not joined to this room" });
        }

        const result = await query<{ id: number; created_at: string }>(
          "INSERT INTO api.chat_messages (room_id, user_id, message) VALUES ($1, $2, $3) RETURNING id, created_at",
          [roomId, userId, text],
        );

        if (!result.rows[0])
          return send(ws, "error", { message: "Failed to save message" });

        const data = {
          type: "message",
          roomId,
          message: {
            id: result.rows[0].id,
            user_id: userId,
            user_name: userName,
            message: text,
            created_at: result.rows[0].created_at,
          },
        };

        broadcast(roomId, data);
        send(ws, "message", data);
        return;
      }

      // Typing indicator
      if (msg.type === "typing") {
        const roomId = parseInt(msg.roomId);
        if (roomId && !isNaN(roomId) && joinedRooms.has(roomId)) {
          broadcast(
            roomId,
            {
              type: "typing",
              roomId,
              user: { id: userId, name: userName },
              isTyping: msg.isTyping === true,
            },
            userId,
          );
        }
        return;
      }

      send(ws, "error", { message: "Unknown message type" });
    } catch {
      send(ws, "error", { message: "Internal server error" });
    }
  };

  ws.onclose = () => {
    if (userId) {
      removeFromSet(clients, userId, ws);
      joinedRooms.forEach((roomId) => {
        removeFromSet(roomMembers, roomId, userId);
        broadcast(roomId, {
          type: "user_left",
          roomId,
          user: { id: userId, name: userName },
        });
      });
    }
  };
}

Deno.serve({
  port: parseInt(WS_PORT),
  handler: (req) => {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket);
    return response;
  },
});

console.log(`WebSocket server listening on port ${WS_PORT}`);
