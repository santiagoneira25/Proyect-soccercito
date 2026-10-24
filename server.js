const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.get("/", (_req, res) => res.type("text").send("Fútbol en Bloques: servidor online activo."));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

// rooms: código -> { players: Map(socketId -> presence), hostId }
const rooms = new Map();
function sendPeers(code) {
  const room = rooms.get(code);
  if (!room) return;
  const peers = [...room.players.entries()].map(([id, presence]) => ({
    id,
    sameTab: false,
    presence
  }));
  io.to(code).emit("roomPeers", { code, peers });
}
function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

io.on("connection", socket => {
  socket.on("createRoom", (payload, callback) => {
    const code = cleanCode(payload && payload.code);
    if (code.length !== 4) return callback?.({ ok: false, error: "Código inválido" });
    if (rooms.has(code)) return callback?.({ ok: false, error: "Ese código ya existe; intenta crear otra sala" });
    const presence = payload && payload.presence || {};
    const room = { players: new Map([[socket.id, { ...presence, r: "h", c: code }]]), hostId: socket.id };
    rooms.set(code, room);
    socket.join(code);
    callback?.({ ok: true, code });
    sendPeers(code);
  });

  socket.on("joinRoom", (payload, callback) => {
    const code = cleanCode(payload && payload.code);
    const room = rooms.get(code);
    if (!room) return callback?.({ ok: false, error: "No existe esa sala. Pide al anfitrión que la cree de nuevo" });
    if (room.players.size >= 2) return callback?.({ ok: false, error: "La sala ya tiene dos jugadores" });
    if (room.players.has(socket.id)) return callback?.({ ok: true, code });
    const presence = payload && payload.presence || {};
    room.players.set(socket.id, { ...presence, r: "g", c: code });
    socket.join(code);
    callback?.({ ok: true, code });
    sendPeers(code);
  });

  socket.on("presenceUpdate", payload => {
    const code = cleanCode(payload && payload.code);
    const room = rooms.get(code);
    if (!room || !room.players.has(socket.id)) return;
    const previous = room.players.get(socket.id) || {};
    const next = payload && payload.presence || {};
    // El cliente solo puede actualizar su propia presencia dentro de la sala.
    room.players.set(socket.id, { ...previous, ...next, c: code });
    sendPeers(code);
  });

  socket.on("gameEvent", payload => {
    const code = cleanCode(payload && payload.code);
    const room = rooms.get(code);
    if (!room || !room.players.has(socket.id)) return;
    if (!payload || typeof payload.type !== "string") return;
    // El estado del partido solo lo envía el anfitrión; el invitado solo manda controles por presencia.
    if (room.hostId !== socket.id) return;
    if (payload.type !== "st") return;
    socket.to(code).emit("gameEvent", payload);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      if (!room.players.has(socket.id)) continue;
      const wasHost = room.hostId === socket.id;
      room.players.delete(socket.id);
      if (wasHost || room.players.size === 0) {
        io.to(code).emit("roomClosed", { code, reason: "El anfitrión se desconectó" });
        rooms.delete(code);
      } else {
        sendPeers(code);
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => console.log(`Servidor de Fútbol en Bloques escuchando en ${port}`));
