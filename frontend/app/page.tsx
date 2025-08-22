import { useEffect } from "react";

const BACKEND_URL = "http://localhost:3001"; 

export default function Home() {
  useEffect(() => {
    const makeRequest = async () => {
      const response = await fetch(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          "messsage": "what is 2+2", 
          "model": "openai/gpt-4o"
        }),
      });

      if (!response.body) {
        console.error("No response body");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            console.log("Stream finished");
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          console.log("Received Chunk:", chunk);
        }
      } catch (error) {
        console.error("Error reading stream", error);
      } finally {
        reader.releaseLock();
      }
    };

    makeRequest(); 
  }, []);

  return (
    <div>
      <h1>Chat Client</h1>
    </div>
  );
}
