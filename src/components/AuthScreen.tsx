import React, { useState } from "react";
import { signInWithPopup, signInWithRedirect, signInAnonymously } from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { Brain, LogIn, Sparkles, UserCheck } from "lucide-react";

interface AuthScreenProps {
  onGuestMode: () => void;
}

export default function AuthScreen({ onGuestMode }: AuthScreenProps) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.warn("Iframe Auth popup block, falling back to redirect...", err);
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (redirErr: any) {
        setErrorMsg("Google login was blocked by iframe/sandbox constraints. Please use 'Demo / Guest Quick Login' below!");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      // Authenticates anonymously so they have a real authenticated context matching existing firestore rules constraints
      await signInAnonymously(auth);
    } catch (err: any) {
      console.error("Demo login error: ", err);
      // If anonymous auth fails, trigger offline guest mode state
      onGuestMode();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="auth_container" className="min-h-screen bg-[#0B0C0E] flex items-center justify-center p-4">
      <div id="auth_card" className="w-full max-w-md bg-[#111318] rounded-2xl shadow-2xl border border-[#2D3139] overflow-hidden text-center relative p-8">
        {/* Background gradient subtle glow */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-700" />
        
        {/* Icon Header */}
        <div className="mx-auto w-16 h-16 bg-gradient-to-tr from-indigo-550 to-indigo-700 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/10 mb-6 mt-4 border border-indigo-500/20">
          <Brain className="w-8 h-8 text-white" />
        </div>

        <h1 className="text-3xl font-extrabold text-[#E2E8F0] tracking-tight mb-2">
          Knowledge Base Q&A
        </h1>
        <p className="text-xs text-[#94A3B8] max-w-sm mx-auto mb-8 leading-relaxed">
          A centralized, private AI-powered knowledge hub. Upload PDFs, files, websites, and videos, then query them with complete grounding and citation trust.
        </p>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 text-left">
            <p className="font-semibold">{errorMsg}</p>
          </div>
        )}

        <div className="space-y-4">
          <button
            id="google_login_btn"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full h-12 flex items-center justify-center gap-3 bg-[#1E2128] text-[#E2E8F0] hover:bg-[#2D3139] active:bg-[#111318] border border-[#2D3139] hover:border-[#475569] font-medium rounded-xl transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <LogIn className="w-5 h-5 text-indigo-400" />
            <span>Connect with Google Account</span>
          </button>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-[#2D3139]"></div>
            <span className="flex-shrink mx-4 text-[10px] text-[#64748B] uppercase tracking-widest font-mono">Or Quick Access</span>
            <div className="flex-grow border-t border-[#2D3139]"></div>
          </div>

          <button
            id="demo_login_btn"
            onClick={handleDemoLogin}
            disabled={isLoading}
            className="w-full h-12 flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Sparkles className="w-5 h-5 text-indigo-100 animate-pulse" />
            <span>Instant Demo / Guest Mode</span>
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-[#2D3139] flex items-center justify-center gap-1.5 text-xs text-[#64748B]">
          <UserCheck className="w-3.5 h-3.5 text-[#64748B]" />
          <span>Secured through Firebase & Google API</span>
        </div>
      </div>
    </div>
  );
}
