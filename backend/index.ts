import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import aiRouter from "./routes/ai";
import authRouter from "./routes/auth";
import { RedisStore } from "store/RedisStore";


dotenv.config(); 

const app: express.Application = express();

// CORS configuration - Allow frontend to access backend
const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:3001", // Allow your frontend origin
  credentials: true, // Allow cookies to be sent
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS','PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser()); 

// Handle preflight requests
app.options('*', cors(corsOptions));

// Routes
app.use("/ai", aiRouter);
app.use("/auth", authRouter); 

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Server initialization with Redis
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize Redis store
    const store = RedisStore.getInstance();
    await store.connect();
    console.log('✓ Redis store initialized');

    // Start Express server
    app.listen(PORT, () => {
      console.log(`✓ Server running at http://localhost:${PORT}`);
      console.log(`✓ CORS enabled for: ${process.env.FRONTEND_URL || "http://localhost:3001"}`);
    });

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      try {
        await store.destroy();
        console.log('✓ Redis connection closed');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
