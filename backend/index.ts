import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import aiRouter from "./routes/ai";
import authRouter from "./routes/auth";

dotenv.config(); 

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/ai", aiRouter);
app.use("/auth", authRouter); 

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
