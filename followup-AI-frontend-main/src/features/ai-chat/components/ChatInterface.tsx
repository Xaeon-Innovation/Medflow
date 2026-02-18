"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    Send,
    Bot,
    User,
    Sparkles,
    Clock,
    Zap,
    FileText,
    Siren,
    Plus,
    MoreVertical
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { createChatSession, sendChatMessage } from "@/lib/ai-api";
import type { ChatMessage } from "@/types/ai";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const SESSION_TYPES = [
    { value: "CLINICAL_COPILOT", label: "Clinical Copilot", icon: Sparkles, desc: "General medical Q&A", color: "text-blue-400", bg: "bg-blue-500/10" },
    { value: "TRIAGE", label: "Triage Assistant", icon: Siren, desc: "Risk assessment", color: "text-rose-400", bg: "bg-rose-500/10" },
    { value: "DOCUMENTATION", label: "Documentation", icon: FileText, desc: "Note generation", color: "text-emerald-400", bg: "bg-emerald-500/10" },
];

const QUICK_PROMPTS = [
    "Differential diagnosis for chest pain",
    "Warfarin drug interactions",
    "Type 2 Diabetes guidelines",
    "Generate SOAP note template",
];

export function ChatInterface() {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionType, setSessionType] = useState("CLINICAL_COPILOT");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    useEffect(() => scrollToBottom(), [messages, scrollToBottom]);

    const startSession = async () => {
        setCreating(true);
        try {
            const session = await createChatSession("default-clinic", sessionType);
            setSessionId(session.id);
            setMessages([]);
        } catch (err) {
            console.error("Failed to create session:", err);
        } finally {
            setCreating(false);
        }
    };

    const handleSend = async (text?: string) => {
        const msg = text || input.trim();
        if (!msg || !sessionId || loading) return;

        const userMsg: ChatMessage = {
            id: `temp-${Date.now()}`,
            sessionId,
            role: "user",
            content: msg,
            createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setLoading(true);

        try {
            const res = await sendChatMessage(sessionId, msg);
            setMessages((prev) => [
                ...prev.filter((m) => m.id !== userMsg.id),
                res.userMessage,
                res.assistantMessage,
            ]);
        } catch (err) {
            const errMsg: ChatMessage = {
                id: `err-${Date.now()}`,
                sessionId,
                role: "assistant",
                content: "⚠️ Failed to get a response. Please try again.",
                createdAt: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, errMsg]);
        } finally {
            setLoading(false);
            // Autofocus
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // ─── Empty State / Session Starter ─────────────────
    if (!sessionId) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-8 bg-gradient-to-br from-slate-950 to-slate-900">
                <div className="w-full max-w-2xl space-y-12">
                    <div className="text-center space-y-4">
                        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-[0_0_40px_-10px_rgba(20,184,166,0.6)]">
                            <Bot className="h-10 w-10 text-white" />
                        </div>
                        <h1 className="text-4xl font-bold tracking-tight text-white">
                            MedGemma <span className="text-teal-400">AI</span>
                        </h1>
                        <p className="text-lg text-slate-400 max-w-md mx-auto">
                            Advanced clinical reasoning powered by Google's MedGemma 27B model. Choose a mode to begin.
                        </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                        {SESSION_TYPES.map((st) => (
                            <button
                                key={st.value}
                                onClick={() => setSessionType(st.value)}
                                className={cn(
                                    "group relative flex flex-col items-start gap-4 rounded-2xl border p-6 transition-all duration-300",
                                    sessionType === st.value
                                        ? "border-teal-500/50 bg-teal-500/10 shadow-[0_0_20px_-5px_rgba(20,184,166,0.3)]"
                                        : "border-white/5 bg-slate-900/50 hover:bg-slate-800/50 hover:border-white/10"
                                )}
                            >
                                <div className={cn("rounded-xl p-3 transition-colors", st.bg, st.color)}>
                                    <st.icon className="h-6 w-6" />
                                </div>
                                <div className="text-left">
                                    <h3 className={cn("font-semibold transition-colors", sessionType === st.value ? "text-teal-100" : "text-slate-200 group-hover:text-white")}>
                                        {st.label}
                                    </h3>
                                    <p className="mt-1 text-sm text-slate-500 group-hover:text-slate-400">
                                        {st.desc}
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="flex justify-center pt-4">
                        <Button
                            onClick={startSession}
                            disabled={creating}
                            className="h-14 w-full md:w-64 rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-600 text-lg font-semibold text-white shadow-lg shadow-teal-500/25 hover:from-teal-400 hover:to-cyan-500 hover:shadow-teal-500/40 transition-all"
                        >
                            {creating ? "Initializing..." : "Start Session"}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Chat View ─────────────────────────────────────
    const activeSession = SESSION_TYPES.find(s => s.value === sessionType);

    return (
        <div className="flex flex-col h-full bg-slate-950 relative overflow-hidden">
            {/* Header */}
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 bg-slate-900/50 px-6 backdrop-blur-xl z-20">
                <div className="flex items-center gap-3">
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", activeSession?.bg)}>
                        {activeSession && <activeSession.icon className={cn("h-4 w-4", activeSession.color)} />}
                    </div>
                    <div>
                        <h2 className="font-semibold text-slate-100">{activeSession?.label}</h2>
                        <div className="flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                            </span>
                            <span className="text-xs text-teal-400 font-medium">Online</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setSessionId(null); setMessages([]); }}
                        className="text-slate-400 hover:text-white hover:bg-white/5"
                    >
                        <Plus className="mr-2 h-4 w-4" /> New Session
                    </Button>
                    <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
                        <MoreVertical className="h-5 w-5" />
                    </Button>
                </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                <AnimatePresence initial={false}>
                    {messages.length === 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col items-center justify-center h-full text-center space-y-6 opacity-60"
                        >
                            <Bot className="h-12 w-12 text-slate-600" />
                            <p className="text-slate-500">How can I assist with this patient case?</p>
                            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                                {QUICK_PROMPTS.map((p, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSend(p)}
                                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors"
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {messages.map((msg) => (
                        <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className={cn(
                                "flex w-full items-start gap-4",
                                msg.role === "user" ? "flex-row-reverse" : "flex-row"
                            )}
                        >
                            {/* Avatar */}
                            <div className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-lg",
                                msg.role === "user" ? "bg-slate-800" : "bg-teal-600"
                            )}>
                                {msg.role === "user" ? <User className="h-4 w-4 text-slate-400" /> : <Bot className="h-4 w-4 text-white" />}
                            </div>

                            {/* Bubble */}
                            <div className={cn(
                                "relative max-w-[80%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-sm",
                                msg.role === "user"
                                    ? "bg-slate-800 text-slate-100 rounded-tr-sm border border-white/5"
                                    : "bg-teal-500/10 text-slate-50 rounded-tl-sm border border-teal-500/20 shadow-[0_0_15px_-3px_rgba(20,184,166,0.1)]"
                            )}>
                                <div className="whitespace-pre-wrap">{msg.content}</div>

                                {msg.role === "assistant" && (
                                    <div className="mt-3 flex items-center gap-3 border-t border-white/5 pt-2">
                                        {msg.inferenceTimeMs && (
                                            <span className="flex items-center gap-1 text-[10px] text-teal-500/80 font-mono">
                                                <Zap className="h-3 w-3" /> {(msg.inferenceTimeMs / 1000).toFixed(2)}s
                                            </span>
                                        )}
                                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                            <Clock className="h-3 w-3" /> Just now
                                        </span>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {loading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-start gap-4"
                    >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600/50 animate-pulse">
                            <Bot className="h-4 w-4 text-white/50" />
                        </div>
                        <div className="flex items-center gap-1 rounded-2xl bg-white/5 px-4 py-3">
                            <span className="h-2 w-2 rounded-full bg-teal-500 animate-[bounce_1s_infinite_0ms]"></span>
                            <span className="h-2 w-2 rounded-full bg-teal-500 animate-[bounce_1s_infinite_200ms]"></span>
                            <span className="h-2 w-2 rounded-full bg-teal-500 animate-[bounce_1s_infinite_400ms]"></span>
                        </div>
                    </motion.div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 md:p-6 pt-2 z-20">
                <div className="relative mx-auto max-w-4xl rounded-2xl bg-slate-900/80 backdrop-blur-xl border border-white/10 p-2 shadow-2xl shadow-black/50">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask MedGemma..."
                        rows={1}
                        disabled={loading}
                        className="w-full resize-none bg-transparent px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-50 max-h-[200px] overflow-y-auto"
                        style={{ height: 'auto' }}
                        onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                        }}
                    />
                    <div className="flex justify-between items-center px-2 pb-1 pt-2 border-t border-white/5 mt-1">
                        <div className="text-[10px] text-slate-500 flex gap-2">
                            <span className="keyboard-shortcut hidden md:inline-block rounded border border-white/10 bg-white/5 px-1.5 py-0.5">Enter</span> to send
                            <span className="keyboard-shortcut hidden md:inline-block rounded border border-white/10 bg-white/5 px-1.5 py-0.5">Shift + Enter</span> for new line
                        </div>
                        <Button
                            onClick={() => handleSend()}
                            disabled={!input.trim() || loading}
                            size="icon"
                            className={cn(
                                "h-8 w-8 rounded-lg transition-all",
                                input.trim()
                                    ? "bg-teal-500 text-white hover:bg-teal-400 shadow-[0_0_15px_-3px_rgba(20,184,166,0.4)]"
                                    : "bg-white/5 text-slate-500"
                            )}
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
