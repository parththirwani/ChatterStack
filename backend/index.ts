import express from "express"
import { createCompletion } from "openrouter";
import { CreateChatSchema } from "types";

const app = express();

app.use(express.json());

app.post("/chat",(req,res)=>{
    const {success,data}= CreateChatSchema.safeParse(req.body);

    if(!success){
        res.status(411).json({
            message:"Incorrect inputs"
        })
        return
    }

    //EventEmitters
    createCompletion(data);

})

app.listen(3000);
