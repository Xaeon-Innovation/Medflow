"use client";

import { Badge } from "@/components/ui";
import type { ChannelType, Conversation, NoShowRiskLevel } from "@/types";

const channelLabels: Record<ChannelType, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

export interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  channelFilter: ChannelType | "";
  riskFilter: NoShowRiskLevel | "";
  searchQuery: string;
  onChannelFilterChange: (v: ChannelType | "") => void;
  onRiskFilterChange: (v: NoShowRiskLevel | "") => void;
  onSearchChange: (v: string) => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  channelFilter,
  riskFilter,
  searchQuery,
  onChannelFilterChange,
  onRiskFilterChange,
  onSearchChange,
}: ConversationListProps) {
  return (
    <div className="flex h-full flex-col border-r border-border bg-muted/30 w-80 shrink-0">
      <div className="p-2 space-y-2 border-b border-border">
        <input
          type="search"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap gap-1">
          <select
            value={channelFilter}
            onChange={(e) => onChannelFilterChange(e.target.value as ChannelType | "")}
            className="h-8 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All channels</option>
            {(["sms", "whatsapp", "email"] as const).map((ch) => (
              <option key={ch} value={ch}>{channelLabels[ch]}</option>
            ))}
          </select>
          <select
            value={riskFilter}
            onChange={(e) => onRiskFilterChange(e.target.value as NoShowRiskLevel | "")}
            className="h-8 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All risk</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </select>
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-3 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors ${
                selectedId === c.id ? "bg-primary/10 border-l-2 border-l-primary" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-foreground truncate">
                  {c.patient?.name ?? "Unknown"}
                </span>
                {c.unreadCount > 0 && (
                  <Badge variant="default" className="shrink-0">
                    {c.unreadCount}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {channelLabels[c.channel]}
                </span>
                {c.patient?.noShowRisk && (
                  <Badge risk={c.patient.noShowRisk} className="text-[10px]">
                    {c.patient.noShowRisk}
                  </Badge>
                )}
              </div>
              {c.lastMessagePreview && (
                <p className="text-xs text-muted-foreground truncate mt-1">
                  {c.lastMessagePreview}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
