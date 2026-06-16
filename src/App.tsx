import React, { useState, useEffect } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth, db } from "./firebase";
import { collection, query, where, onSnapshot, doc, setDoc, getDocs } from "firebase/firestore";
import { Workspace, Document } from "./types";
import AuthScreen from "./components/AuthScreen";
import KnowledgeManager from "./components/KnowledgeManager";
import ChatInterface from "./components/ChatInterface";
import { 
  Brain, LogOut, FolderHeart, Sparkles, MessageSquare, 
  Files, HelpCircle, AlertCircle, RefreshCw, UserCircle, Plus
} from "lucide-react";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState(false);

  // Workspaces
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  // Documents
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Global UI states
  const [activeTab, setActiveTab] = useState<"chat" | "sources">("chat");
  const [globalError, setGlobalError] = useState<string | null>(null);

  // 1. Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthInitialized(true);
      if (currentUser) {
        setIsGuestMode(false);
        await ensureWorkspaceExists(currentUser.uid, currentUser.email || "guest@demo.local");
      } else {
        setWorkspaces([]);
        setActiveWorkspace(null);
        setDocuments([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // 2. Ensure at least one Workspace exists for logged-in UID
  const ensureWorkspaceExists = async (uid: string, email: string) => {
    setGlobalError(null);
    try {
      const workspaceRef = collection(db, "workspaces");
      const q = query(workspaceRef, where("ownerId", "==", uid));
      const querySnapshot = await getDocs(q);

      const existingWorkspaces: Workspace[] = [];
      querySnapshot.forEach((docSnap) => {
        existingWorkspaces.push(docSnap.data() as Workspace);
      });

      if (existingWorkspaces.length > 0) {
        setWorkspaces(existingWorkspaces);
        setActiveWorkspace(existingWorkspaces[0]);
      } else {
        // Create default workspace
        const newWorkspaceId = "ws_" + Math.random().toString(36).substring(2, 11);
        const newWorkspace: Workspace = {
          workspaceId: newWorkspaceId,
          name: "My Personal Base",
          ownerId: uid,
          members: [uid],
          createdAt: new Date().toISOString(),
        };

        await setDoc(doc(db, "workspaces", newWorkspaceId), newWorkspace);
        setWorkspaces([newWorkspace]);
        setActiveWorkspace(newWorkspace);
      }
    } catch (err: any) {
      console.error("Workspace initial check failed:", err);
      setGlobalError("Failed talking to Firebase database. Check connection or Firestore rules.");
    }
  };

  // 3. Load documents of active Workspace
  useEffect(() => {
    if (!activeWorkspace) {
      setDocuments([]);
      return;
    }

    setDocsLoading(true);
    const docsRef = collection(db, "workspaces", activeWorkspace.workspaceId, "documents");
    const q = query(docsRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Document[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as Document);
        });
        setDocuments(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setDocsLoading(false);
      },
      (error) => {
        console.error("Documents fetch failed:", error);
        setGlobalError("Access privileges denied or workspace is locked.");
        setDocsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeWorkspace]);

  // Refresh Docs trigger
  const handleRefreshDocs = async () => {
    if (!activeWorkspace) return;
    setDocsLoading(true);
    const docsRef = collection(db, "workspaces", activeWorkspace.workspaceId, "documents");
    const snap = await getDocs(docsRef);
    const list: Document[] = [];
    snap.forEach((docSnap) => {
      list.push(docSnap.data() as Document);
    });
    setDocuments(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setDocsLoading(false);
  };

  // Create workspace helper
  const handleAddNewWorkspace = async () => {
    if (!user) return;
    const roomName = window.prompt("Enter name for the new Knowledge Workspace:");
    if (!roomName || !roomName.trim()) return;

    setIsCreatingWorkspace(true);
    const newWorkspaceId = "ws_" + Math.random().toString(36).substring(2, 11);
    const newWorkspace: Workspace = {
      workspaceId: newWorkspaceId,
      name: roomName.trim(),
      ownerId: user.uid,
      members: [user.uid],
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, "workspaces", newWorkspaceId), newWorkspace);
      const updatedList = [...workspaces, newWorkspace];
      setWorkspaces(updatedList);
      setActiveWorkspace(newWorkspace);
    } catch (err) {
      console.error("Failed creating workspace:", err);
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleSignOut = () => {
    signOut(auth);
    setIsGuestMode(false);
  };

  // Render Auth screen first if not initialized or not signed in
  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-[#0B0C0E] flex flex-col items-center justify-center p-4">
        <div className="flex items-center gap-3 mb-4">
          <Brain className="w-8 h-8 text-indigo-500 animate-pulse" />
          <span className="font-bold text-[#E2E8F0]">Connecting security tunnels...</span>
        </div>
      </div>
    );
  }

  if (!user && !isGuestMode) {
    return <AuthScreen onGuestMode={() => setIsGuestMode(true)} />;
  }

  // Active workspace rendering
  const currentUserId = user ? user.uid : "guest_caller";
  const currentUserEmail = user ? user.email || "guest@demo.local" : "guest@demo.local";

  return (
    <div id="application_viewport" className="min-h-screen bg-[#0B0C0E] flex flex-col text-[#E2E8F0]">
      
      {/* Primary Header Navbar */}
      <header className="bg-[#111318] border-b border-[#2D3139] px-6 py-4 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Brand Left */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-indigo-550 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/10 border border-indigo-500/20">
              <Brain className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
                <span>Personal Knowledge Base</span>
                <span className="bg-indigo-500/10 text-indigo-400 text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-full border border-indigo-500/20">RAG V1</span>
              </h1>
              <p className="text-[10px] text-[#64748B] font-mono">Secured Document indexing & Vector retrieval assistant</p>
            </div>
          </div>

          {/* Controls Right */}
          <div className="flex flex-wrap items-center gap-3">
            
            {/* Workspace Select */}
            {activeWorkspace && (
              <div className="flex items-center gap-2 bg-[#1E2128] p-1 rounded-xl border border-[#2D3139]">
                <select
                  value={activeWorkspace.workspaceId}
                  onChange={(e) => {
                    const ws = workspaces.find(w => w.workspaceId === e.target.value);
                    if (ws) setActiveWorkspace(ws);
                  }}
                  className="bg-[#1E2128] text-[#CBD5E1] border-none text-xs font-semibold px-2 outline-none cursor-pointer"
                >
                  {workspaces.map((ws) => (
                    <option key={ws.workspaceId} value={ws.workspaceId} className="bg-[#111318] text-[#CBD5E1]">
                      {ws.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddNewWorkspace}
                  disabled={isCreatingWorkspace}
                  className="p-1.5 bg-[#2D3139] hover:bg-[#475569] text-indigo-400 hover:text-indigo-300 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                  title="Create new workspace"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Profile Info & Exit */}
            <div className="flex items-center gap-2 border-l border-[#2D3139] pl-3">
              <div className="flex flex-col items-end text-right">
                <span className="text-[11px] font-bold text-[#CBD5E1] max-w-[120px] truncate">
                  {currentUserEmail.split("@")[0]}
                </span>
                <span className="text-[9px] font-mono text-[#64748B] tracking-wider">
                  {user?.isAnonymous ? "QUICK DEMO" : "ACCOUNT"}
                </span>
              </div>
              <button
                id="sign_out_btn"
                onClick={handleSignOut}
                className="p-2 text-[#64748B] hover:text-red-400 hover:bg-[#1E2128] rounded-xl transition-all cursor-pointer"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

          </div>

        </div>
      </header>

      {/* Global Banner Error Handler */}
      {globalError && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-2.5 flex items-center justify-between text-xs text-red-400 font-semibold gap-1.5 max-w-7xl mx-auto w-full mt-4 rounded-xl">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span>{globalError}</span>
          </div>
          <button
            onClick={() => setGlobalError(null)}
            className="text-red-400 hover:text-red-300 font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Primary Container Body */}
      <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:p-6 space-y-6">
        
        {/* Navigation Tabs Bar */}
        <div className="flex items-center justify-between border-b border-[#2D3139] pb-2">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab("chat")}
              className={`pb-2.5 text-xs font-bold transition-all relative flex items-center gap-1.5 cursor-pointer ${
                activeTab === "chat" ? "text-indigo-400" : "text-[#64748B] hover:text-[#94A3B8]"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>QA Chat Playground</span>
              {activeTab === "chat" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("sources")}
              className={`pb-2.5 text-xs font-bold transition-all relative flex items-center gap-1.5 cursor-pointer ${
                activeTab === "sources" ? "text-indigo-400" : "text-[#64748B] hover:text-[#94A3B8]"
              }`}
            >
              <Files className="w-4 h-4" />
              <span>Workspace Sources</span>
              {documents.length > 0 && (
                <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.2 rounded-full font-bold border border-indigo-500/20">
                  {documents.length}
                </span>
              )}
              {activeTab === "sources" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {docsLoading && <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin" />}
            <span className="text-[10px] font-mono text-[#64748B]">
              Workspace ID: {activeWorkspace?.workspaceId || "..."}
            </span>
          </div>
        </div>

        {/* Tab Stages */}
        {activeWorkspace ? (
          <div>
            {activeTab === "chat" ? (
              <ChatInterface
                workspaceId={activeWorkspace.workspaceId}
                userId={currentUserId}
                documents={documents}
              />
            ) : (
              <KnowledgeManager
                workspaceId={activeWorkspace.workspaceId}
                userId={currentUserId}
                documents={documents}
                onRefresh={handleRefreshDocs}
              />
            )}
          </div>
        ) : (
          <div className="p-12 text-center text-[#94A3B8] space-y-2 bg-[#111318] rounded-2xl border border-[#2D3139]">
            <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
            <p className="text-sm font-semibold">Configuring your knowledge base instance...</p>
          </div>
        )}

      </main>

      {/* Standard Footer */}
      <footer className="bg-[#111318] border-t border-[#2D3139] py-6 text-center text-[10px] text-[#64748B] font-mono">
        <p>© 2026 Personal Knowledge Base Q&A Platform • Standard Sandbox compliant</p>
      </footer>

    </div>
  );
}
