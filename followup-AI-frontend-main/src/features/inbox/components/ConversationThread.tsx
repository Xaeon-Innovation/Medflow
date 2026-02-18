"use client";

import { Badge } from "@/components/ui";
import type { ChannelType, Message } from "@/types";

const channelLabels: Record<ChannelType, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

export interface ConversationThreadProps {
  messages: Message[];
  channel: ChannelType;
  composerValue: string;
  onComposerChange: (v: string) => void;
  onSend: () => void;
  channelOptions: { value: string; label: string }[];
  selectedChannel: string;
  onChannelChange: (v: string) => void;
}

export function ConversationThread({
  messages,
  channel,
  composerValue,
  onComposerChange,
  onSend,
  channelOptions,
  selectedChannel,
  onChannelChange,
}: ConversationThreadProps) {
  return (
    <div className="flex h-full flex-col flex-1 min-w-0 bg-background">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No messages yet. Send a message below.
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.direction === "outbound"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <p>{msg.body}</p>
                <div className="flex items-center gap-2 mt-1 opacity-80">
                  <span className="text-xs">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {channelLabels[msg.channel]}
                  </Badge>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-border p-3 space-y-2">
        <div className="flex gap-2">
          <select
            value={selectedChannel}
            onChange={(e) => onChannelChange(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {channelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <textarea
            placeholder="Type a message..."
            value={composerValue}
            onChange={(e) => onComposerChange(e.target.value)}
            rows={2}
            className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!composerValue.trim()}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
