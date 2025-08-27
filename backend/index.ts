import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import aiRouter from "./routes/ai";
import authRouter from "./routes/auth";


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

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`CORS enabled for: ${process.env.FRONTEND_URL || "http://localhost:3001"}`);
});