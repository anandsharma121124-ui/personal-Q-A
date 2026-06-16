import React, { useState, useRef } from "react";
import { db } from "../firebase";
import { collection, doc, setDoc, deleteDoc, query, where, getDocs, writeBatch } from "firebase/firestore";
import { Document } from "../types";
import { 
  FileText, Link, Youtube, CloudUpload, Trash2, 
  CheckCircle, AlertCircle, Loader, Calendar, Globe,
  FileSpreadsheet, FileImage, Layers
} from "lucide-react";

interface KnowledgeManagerProps {
  workspaceId: string;
  userId: string;
  documents: Document[];
  onRefresh: () => void;
}

export default function KnowledgeManager({ workspaceId, userId, documents, onRefresh }: KnowledgeManagerProps) {
  // Tabs for Source Upload
  const [activeTab, setActiveTab] = useState<"file" | "url" | "youtube">("file");

  // Inputs
  const [urlInput, setUrlInput] = useState("");
  const [urlName, setUrlName] = useState("");
  const [youtubeInput, setYoutubeInput] = useState("");
  const [youtubeName, setYoutubeName] = useState("");

  // Upload state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // File Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper: map source formats to icons
  const getSourceIcon = (type: string) => {
    switch (type) {
      case "PDF":
      case "TXT":
      case "DOCX":
      case "Markdown":
        return <FileText className="w-5 h-5 text-indigo-400" />;
      case "CSV":
        return <FileSpreadsheet className="w-5 h-5 text-emerald-400" />;
      case "Image":
        return <FileImage className="w-5 h-5 text-fuchsia-400" />;
      case "URL":
        return <Globe className="w-5 h-5 text-indigo-400" />;
      case "YouTube":
        return <Youtube className="w-5 h-5 text-red-400" />;
      default:
        return <Layers className="w-5 h-5 text-[#64748B]" />;
    }
  };

  // Helper: Convert file to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Strip out metadata prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // Process and ingest content custom handler
  const ingestContent = async (name: string, sourceType: string, base64: string | null, sourceUrl?: string) => {
    setIsProcessing(true);
    setProcessStatus("Initializing upload...");

    // Generate a new Document ID locally
    const documentId = "doc_" + Math.random().toString(36).substring(2, 11);
    const newDocRef = doc(db, "workspaces", workspaceId, "documents", documentId);

    // 1. Write Initial 'processing' Document status to firestore so it registers on screen
    const initialDoc: Document = {
      documentId,
      workspaceId,
      name,
      sourceType: sourceType as any,
      sourceUrl,
      status: "processing",
      progressMsg: "Extracting text and structure...",
      uploadedBy: userId,
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(newDocRef, initialDoc);
      onRefresh();

      setProcessStatus("Calling Gemini extraction pipeline (RAG server)...");

      // 2. Post to custom Backend processing endpoint
      const response = await fetch("/api/documents/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sourceType,
          base64,
          sourceUrl,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "RAG engine failed content extraction.");
      }

      const data = await response.json();
      setProcessStatus(`Transcribed ${data.characterCount} chars. Rendering embedding indexes...`);

      // 3. Batch Write chunks into Firestore under workspace chunks subcollection
      const chunksCollection = collection(db, "workspaces", workspaceId, "chunks");
      
      // Firestore batches can handle up to 500 writes
      const batch = writeBatch(db);
      
      for (const chunk of data.chunks) {
        const chunkId = `chunk_${documentId}_${chunk.index}`;
        const chunkDocRef = doc(chunksCollection, chunkId);
        
        batch.set(chunkDocRef, {
          chunkId,
          documentId,
          workspaceId,
          text: chunk.text,
          embedding: chunk.embedding,
          index: chunk.index,
          metadata: {
            fileName: name,
            sourceType,
            length: chunk.text.length,
            ...chunk.metadata,
          },
        });
      }

      await batch.commit();

      // 4. Update the Document metadata to completed
      await setDoc(newDocRef, {
        ...initialDoc,
        status: "completed",
        progressMsg: "Indexed beautifully.",
        characterCount: data.characterCount,
      });

      setProcessStatus(null);
      setIsProcessing(false);
      onRefresh();

    } catch (err: any) {
      console.error("Ingestion failed:", err);
      setProcessStatus(null);
      setIsProcessing(false);

      // Fault tolerance: update document status to failed
      try {
        await setDoc(newDocRef, {
          ...initialDoc,
          status: "failed",
          progressMsg: err.message || "Failed during indexing pipeline",
        });
        onRefresh();
      } catch (fErr) {
        console.error("Failed writing fallback failure to Firestore", fErr);
      }
    }
  };

  // Handlers for inputs
  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput) return;
    const name = urlName.trim() || new URL(urlInput).hostname || "Web Link";
    setUrlInput("");
    setUrlName("");
    await ingestContent(name, "URL", null, urlInput);
  };

  const handleYoutubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeInput) return;
    const name = youtubeName.trim() || "YouTube Video";
    setYoutubeInput("");
    setYoutubeName("");
    await ingestContent(name, "YouTube", null, youtubeInput);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await processSelectedFile(file);
    }
  };

  const processSelectedFile = async (file: File) => {
    let type = "TXT";
    if (file.name.endsWith(".pdf")) type = "PDF";
    else if (file.name.endsWith(".docx")) type = "DOCX";
    else if (file.name.endsWith(".md")) type = "Markdown";
    else if (file.name.endsWith(".csv")) type = "CSV";
    else if (/\.(jpg|jpeg|png|webp|gif)$/i.test(file.name)) type = "Image";

    const base64 = await fileToBase64(file);
    await ingestContent(file.name, type, base64);
  };

  // Drag and Drop
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      await processSelectedFile(file);
    }
  };

  // Deletions
  const handleDeleteDocument = async (documentId: string) => {
    const confirmDelete = window.confirm("Are you sure you want to permanently delete this document and all its indexed vector chunks?");
    if (!confirmDelete) return;

    try {
      // Delete Document metadata
      await deleteDoc(doc(db, "workspaces", workspaceId, "documents", documentId));

      // Remove chunks linked to this document
      const chunksCollection = collection(db, "workspaces", workspaceId, "chunks");
      const q = query(chunksCollection, where("documentId", "==", documentId));
      const chunkSnaps = await getDocs(q);

      const batch = writeBatch(db);
      chunkSnaps.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();

      onRefresh();
    } catch (err) {
      console.error("Deletion failed:", err);
    }
  };

  return (
    <div id="sources_panel" className="space-y-6">
      
      {/* 2-Columns grid: uploader left, list right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left column: Upload form */}
        <div className="lg:col-span-5 bg-[#111318] p-6 rounded-2xl border border-[#2D3139] shadow-xl space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white">Add Knowledge Source</h2>
            <p className="text-xs text-[#94A3B8]">Inject raw files, websites, or video content to train your AI.</p>
          </div>

          {/* Toggle Tabs */}
          <div className="flex bg-[#0B0C0E] p-1 rounded-xl border border-[#2D3139]">
            <button
              onClick={() => setActiveTab("file")}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === "file" ? "bg-[#1E2128] text-indigo-400 border border-[#2D3139] shadow-sm" : "text-[#64748B] hover:text-[#94A3B8]"
              }`}
            >
              Files
            </button>
            <button
              onClick={() => setActiveTab("url")}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === "url" ? "bg-[#1E2128] text-indigo-400 border border-[#2D3139] shadow-sm" : "text-[#64748B] hover:text-[#94A3B8]"
              }`}
            >
              Web Link
            </button>
            <button
              onClick={() => setActiveTab("youtube")}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === "youtube" ? "bg-[#1E2128] text-indigo-400 border border-[#2D3139] shadow-sm" : "text-[#64748B] hover:text-[#94A3B8]"
              }`}
            >
              YouTube Video
            </button>
          </div>

          {/* Processing overlay loader */}
          {isProcessing && (
            <div className="p-4 bg-[#1E2128] rounded-xl border border-indigo-500/20 flex items-start gap-3 shadow-md">
              <Loader className="w-5 h-5 text-indigo-400 animate-spin mt-0.5 flex-shrink-0" />
              <div className="text-xs">
                <p className="font-semibold text-[#E2E8F0]">RAG pipeline extracting...</p>
                <p className="text-indigo-400 mt-1 font-mono text-[10px]">{processStatus}</p>
              </div>
            </div>
          )}

          {/* Tabs Content */}
          {!isProcessing && activeTab === "file" && (
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragActive ? "border-indigo-500 bg-indigo-500/5" : "border-[#2D3139] hover:border-indigo-500/40 hover:bg-[#1E2128]/50"
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.csv,image/*"
                onChange={handleFileChange}
              />
              <CloudUpload className="mx-auto w-10 h-10 text-[#64748B] mb-3" />
              <p className="text-xs font-medium text-[#CBD5E1]">Drag & Drop or Click to browse</p>
              <p className="text-[10px] text-[#64748B] mt-1.5">
                Supports PDF, DOCX, TXT, MD, CSV, JPG, PNG (Max 15MB)
              </p>
            </div>
          )}

          {!isProcessing && activeTab === "url" && (
            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Website URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/guides/onboarding"
                  required
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="w-full h-10 px-3 bg-[#0B0C0E] border border-[#2D3139] text-[#E2E8F0] rounded-xl text-xs focus:border-indigo-500/50 outline-none placeholder-[#64748B]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Title (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Employee Handbook"
                  value={urlName}
                  onChange={(e) => setUrlName(e.target.value)}
                  className="w-full h-10 px-3 bg-[#0B0C0E] border border-[#2D3139] text-[#E2E8F0] rounded-xl text-xs focus:border-indigo-500/50 outline-none placeholder-[#64748B]"
                />
              </div>
              <button
                type="submit"
                className="w-full h-10 bg-indigo-600 hover:bg-indigo-550 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/10 active:scale-[0.98] transition-all cursor-pointer"
              >
                Ingest Web Page
              </button>
            </form>
          )}

          {!isProcessing && activeTab === "youtube" && (
            <form onSubmit={handleYoutubeSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">YouTube URL</label>
                <input
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  required
                  value={youtubeInput}
                  onChange={(e) => setYoutubeInput(e.target.value)}
                  className="w-full h-10 px-3 bg-[#0B0C0E] border border-[#2D3139] text-[#E2E8F0] rounded-xl text-xs focus:border-indigo-500/50 outline-none placeholder-[#64748B]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Video Title (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Product Demo Kickoff"
                  value={youtubeName}
                  onChange={(e) => setYoutubeName(e.target.value)}
                  className="w-full h-10 px-3 bg-[#0B0C0E] border border-[#2D3139] text-[#E2E8F0] rounded-xl text-xs focus:border-indigo-500/50 outline-none placeholder-[#64748B]"
                />
              </div>
              <button
                type="submit"
                className="w-full h-10 bg-indigo-600 hover:bg-indigo-550 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/10 active:scale-[0.98] transition-all cursor-pointer"
              >
                Transcribe & Index
              </button>
            </form>
          )}

        </div>

        {/* Right column: Document list */}
        <div className="lg:col-span-7 bg-[#111318] p-6 rounded-2xl border border-[#2D3139] shadow-xl flex flex-col">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-white">Knowledge Index ({documents.length})</h2>
            <p className="text-xs text-[#94A3B8]">List of indexed files in workspace. Click search or chat to query.</p>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[400px] border border-[#2D3139] rounded-xl bg-[#0B0C0E]">
            {documents.length === 0 ? (
              <div className="p-8 text-center text-[#64748B] space-y-2">
                <FileText className="w-8 h-8 text-[#2D3139] mx-auto" />
                <p className="text-xs">No documents uploaded to this workspace yet.</p>
                <p className="text-[10px]">Upload a file, web link, or YouTube video to get started.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#111318] border-b border-[#2D3139] text-[#64748B] font-medium font-mono text-[10px] tracking-wider uppercase">
                    <th className="p-3">Source Name</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Size (Char)</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2D3139]">
                  {documents.map((doc) => (
                    <tr id={`doc-row-${doc.documentId}`} key={doc.documentId} className="hover:bg-[#1E2128]/40 transition-colors">
                      <td className="p-3 max-w-[180px] truncate font-medium text-[#E2E8F0]">
                        {doc.sourceUrl ? (
                          <a href={doc.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300">
                            {doc.name}
                          </a>
                        ) : (
                          <span>{doc.name}</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="flex items-center gap-1.5">
                          {getSourceIcon(doc.sourceType)}
                          <span className="text-[10px] font-mono text-[#94A3B8] uppercase">{doc.sourceType}</span>
                        </span>
                      </td>
                      <td className="p-3">
                        {doc.status === "completed" && (
                          <span className="inline-flex items-center gap-1 bg-green-500/10 text-green-400 px-2.5 py-0.5 rounded-full text-[10px] font-medium font-mono border border-green-500/20">
                            <CheckCircle className="w-3 h-3" />
                            <span>Indexed</span>
                          </span>
                        )}
                        {doc.status === "processing" && (
                          <span className="inline-flex items-center gap-1 bg-yellow-500/10 text-yellow-500 px-2.5 py-0.5 rounded-full text-[10px] font-medium font-mono border border-yellow-500/20">
                            <Loader className="w-3 h-3 animate-spin" />
                            <span>Thinking...</span>
                          </span>
                        )}
                        {doc.status === "failed" && (
                          <span title={doc.progressMsg} className="inline-flex items-center gap-1 bg-red-500/10 text-red-400 px-2.5 py-0.5 rounded-full text-[10px] font-medium font-mono border border-red-500/20 cursor-help">
                            <AlertCircle className="w-3 h-3" />
                            <span>Failed</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono text-[#64748B]">
                        {doc.status === "completed" ? doc.characterCount?.toLocaleString() || "0" : "—"}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleDeleteDocument(doc.documentId)}
                          className="p-1 text-[#64748B] hover:text-red-400 rounded-lg hover:bg-[#1E2128] transition-all cursor-pointer"
                          title="Delete source"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
