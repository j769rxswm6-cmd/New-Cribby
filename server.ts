import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';

async function startServer() {
  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
    },
  });

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // WebRTC Signaling via Socket.io
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-room', (roomId, role) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId} as ${role}`);
      
      // Notify others in the room
      socket.to(roomId).emit('user-joined', { id: socket.id, role });

      const room = io.sockets.adapter.rooms.get(roomId);
      if (room) {
        // Send everyone in the room back to the joined user
        const usersInRoom = Array.from(room);
        socket.emit('room-users', usersInRoom.filter(id => id !== socket.id));
      }
    });

    socket.on('offer', (payload) => {
      socket.to(payload.target).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
      socket.to(payload.target).emit('answer', payload);
    });

    socket.on('ice-candidate', (payload) => {
      socket.to(payload.target).emit('ice-candidate', payload);
    });
    
    // Custom events for baby monitor
    socket.on('motion-alert', (roomId) => {
      socket.to(roomId).emit('motion-alert', { time: new Date().toISOString() });
    });
    
    socket.on('update-settings', (roomId, settings) => {
      socket.to(roomId).emit('update-settings', settings);
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      // Usually would want to notify rooms the user was in
    });
  });

  // API Route for health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date() });
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve dist folder
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
