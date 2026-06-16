import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase JSON body limits for base64 file payloads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Google GenAI client
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY is not defined. AI features will be unavailable.");
}
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// --- API Endpoints ---

// 1. Process Document: transcribes it and returns text + embeddings
app.post("/api/documents/process", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: "Gemini API client not initialized." });
    }

    const { name, sourceType, base64, sourceUrl } = req.body;
    if (!name || !sourceType) {
      return res.status(400).json({ error: "Missing required fields: name, sourceType." });
    }

    let extractedText = "";

    if (sourceType === "TXT" || sourceType === "Markdown") {
      if (base64) {
        extractedText = Buffer.from(base64, "base64").toString("utf-8");
      } else {
        extractedText = "Empty file.";
      }
    } else if (sourceType === "CSV") {
      if (base64) {
        extractedText = Buffer.from(base64, "base64").toString("utf-8");
      } else {
        extractedText = "Empty CSV.";
      }
    } else if (sourceType === "PDF" || sourceType === "Image") {
      if (!base64) {
        return res.status(400).json({ error: "Missing file payload (base64) for PDF/Image." });
      }

      // Convert PDF or Image with Gemini OCR / structural extraction
      const mimeType = sourceType === "PDF" ? "application/pdf" : "image/jpeg";
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              data: base64,
              mimeType: mimeType,
            },
          },
          "Extract all readable, copyable text from this document, keeping its structures (headings, bullet points, sections, columns, list blocks, table data) intact. Do not summarize or add any introduction.",
        ],
      });

      extractedText = response.text || "Failed to extract text.";
    } else if (sourceType === "URL") {
      if (!sourceUrl) {
        return res.status(400).json({ error: "Missing sourceUrl for URL type." });
      }

      // Scrape URL
      const webRes = await fetch(sourceUrl);
      const htmlText = await webRes.text();

      // Clean HTML using Gemini
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          `Format and extract all relevant textual content into structured markdown from this raw HTML web page: ${htmlText.slice(0, 50000)}. Skip header menus, footer links, cookie prompts and sidebar layouts.`
        ],
      });

      extractedText = response.text || "Failed to extract web content.";
    } else if (sourceType === "YouTube") {
      if (!sourceUrl) {
        return res.status(400).json({ error: "Missing sourceUrl for YouTube." });
      }

      // YouTube processing: Use Gemini Search grounding to research the YouTube video or summarize/extract transcript
      // We will ask Gemini with search grounded tools to find details or transcribe the YouTube url if accessible.
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        config: {
          tools: [{ googleSearch: {} }],
        },
        contents: [
          `Find the transcript or key content of this YouTube video: ${sourceUrl}. Please extract its full detail or transcript, structured by timepoints or logical paragraphs.`
        ],
      });

      extractedText = response.text || "Failed to retrieve YouTube details.";
    } else {
      // DOCX fallback or other
      if (base64) {
        // We can let Gemini read the binary if we label it application/octet-stream or similar,
        // but let's try reading it as text or using Gemini to transcribe the document structure:
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              inlineData: {
                data: base64,
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              }
            },
            "Extract all readable text from this document, maintaining structural headers, sections, bullet points, and table data. Do not summarize."
          ]
        });
        extractedText = response.text || "Failed to extract text from document.";
      } else {
        extractedText = "Empty document payload.";
      }
    }

    // --- Create Chunks ---
    const rawChunks = chunkText(extractedText);
    const resultChunks = [];

    // --- Generate Embeddings for Chunks ---
    for (let i = 0; i < rawChunks.length; i++) {
      const chunkTextContent = rawChunks[i];
      try {
        const embedRes: any = await ai.models.embedContent({
          model: "text-embedding-004",
          contents: chunkTextContent,
        });

        const embedding = embedRes.embedding?.values || embedRes.embeddings?.[0]?.values || [];
        resultChunks.push({
          text: chunkTextContent,
          embedding,
          index: i,
          metadata: {
            fileName: name,
            sourceType,
            length: chunkTextContent.length,
          }
        });
      } catch (embErr) {
        console.error("Embedding generation failed for chunk index: " + i, embErr);
        // Fallback with empty or zero vector if embedding fails
        resultChunks.push({
          text: chunkTextContent,
          embedding: new Array(768).fill(0),
          index: i,
          metadata: {
            fileName: name,
            sourceType,
            length: chunkTextContent.length,
            error: "Failed embedding"
          }
        });
      }
    }

    res.json({
      success: true,
      characterCount: extractedText.length,
      chunks: resultChunks,
    });

  } catch (error: any) {
    console.error("Document processing error:", error);
    res.status(500).json({ error: error.message || "Unknown error during processing." });
  }
});

// 2. Generate Embedding for search query
app.post("/api/embeddings", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: "Gemini API client not initialized." });
    }

    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing 'text' field to embed." });
    }

    const embedRes: any = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: text,
    });

    res.json({
      embedding: embedRes.embedding?.values || embedRes.embeddings?.[0]?.values || [],
    });
  } catch (error: any) {
    console.error("Query embedding error:", error);
    res.status(500).json({ error: error.message || "Embedding error." });
  }
});

// 3. Question Answering: Generates grounded response using Gemini 2.5 Flash
app.post("/api/chat/answer", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: "Gemini API client not initialized." });
    }

    const { query, contextChunks } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing 'query'." });
    }

    // Build the RAG system prompt with context chunks
    const contextText = (contextChunks || [])
      .map((c: any, index: number) => {
        return `[Source ${index + 1}]: ${c.metadata?.fileName || "Unknown Document"} (Type: ${c.metadata?.sourceType || "Web"})\nContent:\n${c.text}\n---`;
      })
      .join("\n\n");

    const systemPrompt = `You are an advanced, helpful, and highly accurate AI Knowledge Base Assistant.
Your goal is to answer the user's question.
You MUST rely ONLY on the logical, factual context provided in the context section below.
If the answer is NOT present or cannot be inferred from the context context, state clearly and honestly: "I'm sorry, but that information is not available in the uploaded knowledge base." or "The provided knowledge base does not contain details about: ...". Do not make up facts or use outside knowledge.

Every statement you make that is derived from a Source MUST include a precise citation or reference (e.g. "[Source 1]", "[Source 2]") at the end of the sentence or statement. Add multiple citations if multiple sources support the point.

CONTEXT DIRECTIVE:
${contextText || "[No documents or sources have been uploaded or matched for this question yet.]"}

Ensure your responses are clear, professional, well-structured list formats or concise prose, and cite your sources exactly matching the numbering.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "system", parts: [{ text: systemPrompt }] },
        { role: "user", parts: [{ text: query }] }
      ]
    });

    res.json({
      answer: response.text || "Unable to formulate answer.",
    });
  } catch (error: any) {
    console.error("Model Generation error:", error);
    res.status(500).json({ error: error.message || "Generation error." });
  }
});

// --- Simple slidling-window chunker function ---
function chunkText(text: string, chunkSize: number = 1000, chunkOverlap: number = 200): string[] {
  if (!text) return [];
  // Split by double newline to keep paragraphs as cohesive blocks
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    if (currentChunk.length + trimmedPara.length <= chunkSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmedPara;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      
      // If paragraph is larger than chunk size, break it into smaller sub-chunks
      if (trimmedPara.length > chunkSize) {
        let start = 0;
        while (start < trimmedPara.length) {
          const end = Math.min(start + chunkSize, trimmedPara.length);
          chunks.push(trimmedPara.slice(start, end));
          start += chunkSize - chunkOverlap;
          if (start >= trimmedPara.length - chunkOverlap) break;
        }
      } else {
        currentChunk = trimmedPara;
      }
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  return chunks;
}

// --- Serve Frontend Application and Listen ---

async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to bootstrap server:", err);
});
