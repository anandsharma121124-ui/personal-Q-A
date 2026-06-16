import React, { useState, useEffect, useRef } from "react";
import { db } from "../firebase";
import { collection, doc, setDoc, addDoc, query, orderBy, onSnapshot, getDocs, limit, updateDoc } from "firebase/firestore";
import { ChatMessage, Conversation, Document, DocumentChunk, Citation } from "../types";
import { 
  Send, Bot, User, Brain, Plus, MessageSquare, 
  HelpCircle, Sparkles, FileText, CheckCircle, 
  BookOpen, ChevronRight, Bookmark, Loader
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ChatInterfaceProps {
  workspaceId: string;
  userId: string;
  documents: Document[];
}

export default function ChatInterface({ workspaceId, userId, documents }: ChatInterfaceProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeSession, setActiveSession] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Active citation modal state
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Suggested starter prompts based on documents
  const sampleSuggestions = [
    "Give me a high-level summary of our uploaded knowledge",
    "What are the main takeaways or core instructions in the documents?",
    "List all action items mentioned in our guides",
  ];

  // 1. Load conversations
  useEffect(() => {
    const convoCollection = collection(db, "workspaces", workspaceId, "conversations");
    const q = query(convoCollection, orderBy("createdAt", "desc"), limit(40));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Conversation[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as Conversation);
      });
      setConversations(list);
      
      // Auto-select first conversation if exists and none is selected
      if (list.length > 0 && !activeSession) {
        setActiveSession(list[0]);
      }
    });

    return () => unsubscribe();
  }, [workspaceId]);

  // 2. Load messages for selected session
  useEffect(() => {
    if (!activeSession) {
      setMessages([]);
      return;
    }

    const msgsCollection = collection(db, "workspaces", workspaceId, "conversations", activeSession.conversationId, "messages");
    const q = query(msgsCollection, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: ChatMessage[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as ChatMessage);
      });
      setMessages(list);
    });

    return () => unsubscribe();
  }, [workspaceId, activeSession]);

  // Scroll to bottom on updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  // Create workspace chat thread
  const handleCreateSession = async () => {
    const conversationId = "convo_" + Math.random().toString(36).substring(2, 11);
    const convoRef = doc(db, "workspaces", workspaceId, "conversations", conversationId);
    
    const newConvo: Conversation = {
      conversationId,
      workspaceId,
      userId,
      title: "New Dialogue " + new Date().toLocaleDateString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(convoRef, newConvo);
      setActiveSession(newConvo);
    } catch (err) {
      console.error("Failed creating chat session:", err);
    }
  };

  // Cosine Similarity calculator
  const computeSimilarity = (vecA: number[], vecB: number[]): number => {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  // Main prompt RAG search and answer stream controller
  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isGenerating) return;

    let currentSession = activeSession;
    if (!currentSession) {
      // Create a session implicitly if none exists
      const conversationId = "convo_" + Math.random().toString(36).substring(2, 11);
      const convoRef = doc(db, "workspaces", workspaceId, "conversations", conversationId);
      currentSession = {
        conversationId,
        workspaceId,
        userId,
        title: textToSend.slice(0, 30) + (textToSend.length > 30 ? "..." : ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(convoRef, currentSession);
      setActiveSession(currentSession);
    } else {
      // Update Title if it was default
      if (currentSession.title.startsWith("New Dialogue")) {
        const convoRef = doc(db, "workspaces", workspaceId, "conversations", currentSession.conversationId);
        await updateDoc(convoRef, {
          title: textToSend.slice(0, 30) + (textToSend.length > 30 ? "..." : "")
        });
      }
    }

    setInputText("");
    setIsGenerating(true);

    const msgsCollection = collection(db, "workspaces", workspaceId, "conversations", currentSession.conversationId, "messages");

    // 1. Save user query message to Firestore
    const userMsgId = "msg_user_" + Math.random().toString(36).substring(2, 11);
    const userMsg: ChatMessage = {
      messageId: userMsgId,
      conversationId: currentSession.conversationId,
      sender: "user",
      text: textToSend,
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(msgsCollection, userMsgId), userMsg);

    try {
      // 2. Query embedding of user prompt
      const embedRes = await fetch("/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSend }),
      });

      if (!embedRes.ok) {
        throw new Error("Unable to create embedding for retrieval search.");
      }

      const { embedding: queryVector } = await embedRes.json();

      // 3. Load all workspace chunks from Firestore
      const chunksCollection = collection(db, "workspaces", workspaceId, "chunks");
      const chunksSnap = await getDocs(chunksCollection);
      
      const allChunks: DocumentChunk[] = [];
      chunksSnap.forEach((snap) => {
        allChunks.push(snap.data() as DocumentChunk);
      });

      // 4. Calculate similarities and take top-5 relevance matches
      const scoredChunks = allChunks
        .map((chunk) => {
          const score = computeSimilarity(queryVector, chunk.embedding);
          return { chunk, score };
        })
        .filter((item) => item.score > 0.1) // Minimum filter relevance threshold
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // Create citation mapping
      const topCitations: Citation[] = scoredChunks.map((match, idx) => ({
        chunkId: match.chunk.chunkId,
        fileName: match.chunk.metadata?.fileName || "Document",
        sourceType: match.chunk.metadata?.sourceType || "TXT",
        snippet: match.chunk.text,
        index: idx + 1,
      }));

      // 5. Submit context chunks to answer API route
      const answerRes = await fetch("/api/chat/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: textToSend,
          contextChunks: scoredChunks.map((item) => ({
            text: item.chunk.text,
            metadata: {
              fileName: item.chunk.metadata?.fileName,
              sourceType: item.chunk.metadata?.sourceType,
            },
          })),
        }),
      });

      if (!answerRes.ok) {
        throw new Error("RAG answering engine failed.");
      }

      const answerData = await answerRes.json();

      // 6. Save AI feedback to Firestore with citations
      const aiMsgId = "msg_ai_" + Math.random().toString(36).substring(2, 11);
      const aiMsg: ChatMessage = {
        messageId: aiMsgId,
        conversationId: currentSession.conversationId,
        sender: "ai",
        text: answerData.answer,
        citations: topCitations,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(msgsCollection, aiMsgId), aiMsg);

    } catch (err: any) {
      console.error("QA error:", err);
      // Fallback error message
      const aiErrorId = "msg_ai_" + Math.random().toString(36).substring(2, 11);
      await setDoc(doc(msgsCollection, aiErrorId), {
        messageId: aiErrorId,
        conversationId: currentSession.conversationId,
        sender: "ai",
        text: `Error formulating answer: ${err.message || "Unknown error"}. Please check that you've processed files correctly!`,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div id="ai_chat_workspace" className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[550px]">
      
      {/* Session Threads Panel (Left) */}
      <div className="md:col-span-3 bg-[#111318] border border-[#2D3139] rounded-2xl p-4 shadow-xl flex flex-col h-full max-h-[600px] overflow-hidden">
        <button
          id="new_chat_btn"
          onClick={handleCreateSession}
          className="w-full h-10 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 border border-indigo-500/20 hover:border-indigo-500/40 transition-all mb-4 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Discussion</span>
        </button>

        <div className="flex-1 overflow-y-auto space-y-2 max-h-[480px]">
          <p className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-2 px-2">Conversations</p>
          {conversations.length === 0 ? (
            <div className="text-center py-8 text-[#64748B] text-xs px-2">
              <MessageSquare className="w-5 h-5 mx-auto mb-1 text-[#2D3139]" />
              <span>No lines open</span>
            </div>
          ) : (
            conversations.map((convo) => (
              <button
                id={`convo-tab-${convo.conversationId}`}
                key={convo.conversationId}
                onClick={() => setActiveSession(convo)}
                className={`w-full text-left p-3 rounded-xl flex items-center gap-2 text-xs transition-all cursor-pointer ${
                  activeSession?.conversationId === convo.conversationId
                    ? "bg-indigo-600 text-white font-medium shadow-lg shadow-indigo-600/10"
                    : "text-[#CBD5E1] hover:bg-[#1E2128]"
                }`}
              >
                <MessageSquare className="w-4 h-4 flex-shrink-0 opacity-80" />
                <span className="truncate flex-1">{convo.title}</span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Conversation Stage (Right) */}
      <div className="md:col-span-9 bg-[#111318] border border-[#2D3139] rounded-2xl shadow-xl flex flex-col h-full min-h-[500px] max-h-[600px] overflow-hidden relative">
        
        {/* Thread Header */}
        <div className="px-6 py-4 border-b border-[#2D3139] bg-[#0B0C0E]/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {activeSession ? activeSession.title : "Knowledge Assistant"}
              </h3>
              <p className="text-[10px] text-[#64748B]">
                Grounded strictly in {documents.filter(d => d.status === "completed").length} active sources
              </p>
            </div>
          </div>
        </div>

        {/* Conversation Dialog Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 max-h-[420px] bg-[#0B0C0E]/10">
          {documents.filter(d => d.status === "completed").length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#64748B]">
              <Brain className="w-12 h-12 text-[#2D3139] animate-pulse mb-3" />
              <p className="text-sm font-semibold text-[#CBD5E1]">Empty Knowledge Base</p>
              <p className="text-xs max-w-sm mt-1">
                Please upload references, links or PDFs under the **Sources** dashboard tab before querying.
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#1E2128] flex items-center justify-center border border-[#2D3139]">
                <Sparkles className="w-6 h-6 text-indigo-400 animate-bounce" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-[#E2E8F0]">Query your Private Knowledge</p>
                <p className="text-xs text-[#64748B] max-w-sm">
                  Ask conversational questions. Every response utilizes Semantic Search to pull quotes and citations.
                </p>
              </div>

              {/* Sample starter options */}
              <div className="grid grid-cols-1 gap-2 max-w-md w-full pt-4">
                {sampleSuggestions.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInputText(prompt);
                      handleSendMessage(prompt);
                    }}
                    className="p-3 text-left bg-[#1E2128] border border-[#2D3139] hover:border-indigo-500/30 hover:bg-indigo-500/5 rounded-xl text-xs text-[#CBD5E1] hover:text-indigo-400 transition-all shadow-md cursor-pointer"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((msg) => (
                <div
                  key={msg.messageId}
                  className={`flex gap-3 items-start ${msg.sender === "user" ? "justify-end" : ""}`}
                >
                  {/* AI Logo */}
                  {msg.sender === "ai" && (
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5 animate-fade-in">
                      <Bot className="w-4 h-4 text-indigo-400" />
                    </div>
                  )}

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[80%] p-4 rounded-2xl text-xs space-y-3 shadow-md ${
                      msg.sender === "user"
                        ? "bg-indigo-600 text-white rounded-tr-none self-end shadow-indigo-600/10"
                        : "bg-[#1E2128] text-[#E2E8F0] border border-[#2D3139] rounded-tl-none whitespace-pre-wrap"
                    }`}
                  >
                    <p className="leading-relaxed">{msg.text}</p>

                    {/* Citations references (RAG validation) */}
                    {msg.sender === "ai" && msg.citations && msg.citations.length > 0 && (
                      <div className="pt-3 border-t border-[#2D3139] space-y-2">
                        <p className="text-[10px] uppercase font-bold tracking-widest text-[#64748B] font-mono">
                          Sources consulted ({msg.citations.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.citations.map((cite) => (
                            <button
                              id={`citation-btn-${msg.messageId}-${cite.index}`}
                              key={cite.index}
                              onClick={() => setSelectedCitation(cite)}
                              className="inline-flex items-center gap-1.5 bg-[#0B0C0E] hover:bg-[#1E2128] text-[#94A3B8] hover:text-[#E2E8F0] px-2.5 py-1 rounded-lg text-[10px] font-medium font-mono transition-all border border-[#2D3139] hover:border-indigo-500/30 cursor-pointer"
                            >
                              <Bookmark className="w-3 h-3 text-indigo-400" />
                              <span>[{cite.index}] {cite.fileName.slice(0, 18)}{cite.fileName.length > 18 ? "..." : ""}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* User Profile Logo */}
                  {msg.sender === "user" && (
                    <div className="w-8 h-8 rounded-lg bg-[#2D3139] border border-[#475569]/30 flex items-center justify-center flex-shrink-0 mt-0.5 font-mono text-[#E2E8F0] font-bold text-xs uppercase shadow-sm">
                      <User className="w-4 h-4 text-[#CBD5E1]" />
                    </div>
                  )}
                </div>
              ))}

              {/* Loader during Gemini execution */}
              {isGenerating && (
                <div className="flex gap-3 items-start animate-pulse">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                    <Loader className="w-4 h-4 text-indigo-400 animate-spin" />
                  </div>
                  <div className="bg-[#1E2128] border border-[#2D3139] p-4 rounded-2xl rounded-tl-none text-xs text-[#94A3B8] max-w-[80%] flex items-center gap-2 select-none">
                    <span>Synthesizing references, cross-checking datasets...</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input form panel */}
        <div className="p-4 border-t border-[#2D3139] bg-[#0B0C0E]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage(inputText);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              placeholder={
                documents.filter(d => d.status === "completed").length === 0
                  ? "Upload files first to query..."
                  : "Ask anything about your knowledge base..."
              }
              disabled={documents.filter(d => d.status === "completed").length === 0 || isGenerating}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 h-11 px-4 bg-[#111318] border border-[#2D3139] text-[#E2E8F0] placeholder-[#64748B] rounded-xl text-xs focus:ring-1 focus:ring-indigo-550/30 focus:border-indigo-500/50 outline-none disabled:bg-[#1E2128]/20 disabled:text-[#64748B] disabled:cursor-not-allowed transition-all"
            />
            <button
              id="send_msg_btn"
              type="submit"
              disabled={!inputText.trim() || isGenerating}
              className="w-11 h-11 bg-indigo-600 hover:bg-indigo-550 disabled:bg-[#1E2128]/80 text-white disabled:text-[#64748B] rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/10 disabled:shadow-none transition-all cursor-pointer"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>

        {/* Floating citation inspector overlay side-drawer */}
        <AnimatePresence>
          {selectedCitation && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCitation(null)}
              className="absolute inset-0 bg-[#030712]/70 backdrop-blur-xs flex items-center justify-center p-4 z-40 cursor-pointer"
            >
              <motion.div
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg bg-[#111318] rounded-2xl p-6 shadow-2xl border border-[#2D3139] relative cursor-default space-y-4"
              >
                <div className="flex items-center justify-between border-b border-[#2D3139] pb-3">
                  <span className="inline-flex items-center gap-1.5 bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-full font-mono text-xs font-bold border border-indigo-500/20">
                    Source [{selectedCitation.index}]
                  </span>
                  <button
                    onClick={() => setSelectedCitation(null)}
                    className="text-[#64748B] hover:text-[#94A3B8] text-xs font-bold cursor-pointer"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white">
                    {selectedCitation.fileName}
                  </h4>
                  <div className="flex items-center gap-1 text-[10px] text-[#64748B] font-mono">
                    <span>TYPE: {selectedCitation.sourceType}</span>
                    <span>•</span>
                    <span>Grounded RAG snippet verification</span>
                  </div>
                </div>

                <div className="bg-[#0B0C0E] border border-[#2D3139] p-4 rounded-xl max-h-[220px] overflow-y-auto text-xs text-[#CBD5E1] leading-relaxed italic whitespace-pre-line family-serif">
                  {selectedCitation.snippet}
                </div>

                <div className="flex items-center text-[10px] text-green-400 font-semibold gap-1.5 pt-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  <span>Verified semantic alignment matches standard confidence parameters.</span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

    </div>
  );
}
