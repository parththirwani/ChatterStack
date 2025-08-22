import express from "express"
import { createCompletion } from "openrouter";
import { InMemoryStore } from "store/InMeomeryStore";
import { CreateChatSchema, Role } from "types";
import cors from "cors";


const app = express();
app.use(cors())

app.use(express.json());

app.post("/chat", async (req, res) => {
    const { success, data } = CreateChatSchema.safeParse(req.body);

    const conversationId = data?.conversationId ?? Bun.randomUUIDv7();
    if (!success) {
        res.status(411).json({
            message: "Incorrect inputs"
        })
        return
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform"); // no proxy caching or compression
    res.setHeader("Connection", "keep-alive"); //  keep connection open
    res.setHeader("X-Accel-Buffering", "no"); //  disable buffering in nginx/proxies
    res.setHeader("Access-Control-Allow-Origin", "*"); //  CORS for frontend
    res.flushHeaders();
    
    let message = "";
    let existingMessages = InMemoryStore.getInstance().get(conversationId);

    //EventEmitters
    await createCompletion([...existingMessages, {
        role: Role.User,
        content: data.message
    }], data.model,
        (chunk: string) => {
            message += chunk;
            res.write(chunk)
        });
    res.end();

    //Storing one turn of messages per request in the db (turn: one user messsage + one assistant message)
    InMemoryStore.getInstance().add(conversationId, {
        role: Role.User,
        content: data.message
    })

    InMemoryStore.getInstance().add(conversationId, {
        role: Role.Assistant,
        content: message
    })

})

app.listen(3000);
