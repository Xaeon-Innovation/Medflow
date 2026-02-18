"use client";

import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getInboxConversations, getConversationById } from "@/lib/api-client";
import type { ChannelType, NoShowRiskLevel } from "@/types";
import { ConversationList } from "./ConversationList";
import { ConversationThread } from "./ConversationThread";
import { PatientPanel } from "./PatientPanel";

const channelLabels: Record<ChannelType, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

const channelOptions = [
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
];

export function InboxLayout() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelType | "">("");
  const [riskFilter, setRiskFilter] = useState<NoShowRiskLevel | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [composerValue, setComposerValue] = useState("");
  const [composerChannel, setComposerChannel] = useState("whatsapp");

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: getInboxConversations,
  });

  const { data: selectedConversation } = useQuery({
    queryKey: ["conversation", selectedId],
    queryFn: () => getConversationById(selectedId!),
    enabled: !!selectedId,
  });

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (channelFilter && c.channel !== channelFilter) return false;
      if (riskFilter && c.patient?.noShowRisk !== riskFilter) return false;
      if (
        searchQuery &&
        !c.patient?.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    });
  }, [conversations, channelFilter, riskFilter, searchQuery]);

  const handleSend = useCallback(() => {
    if (!composerValue.trim()) return;
    // Placeholder: would call API to send message
    setComposerValue("");
  }, [composerValue]);

  return (
    <div className="flex h-full w-full min-h-0">
      <ConversationList
        conversations={filteredConversations}
        selectedId={selectedId}
        onSelect={setSelectedId}
        channelFilter={channelFilter}
        riskFilter={riskFilter}
        searchQuery={searchQuery}
        onChannelFilterChange={setChannelFilter}
        onRiskFilterChange={setRiskFilter}
        onSearchChange={setSearchQuery}
      />
      <ConversationThread
        messages={selectedConversation?.messages ?? []}
        channel={
          selectedConversation?.channel ?? ("whatsapp" as ChannelType)
        }
        composerValue={composerValue}
        onComposerChange={setComposerValue}
        onSend={handleSend}
        channelOptions={channelOptions}
        selectedChannel={composerChannel}
        onChannelChange={setComposerChannel}
      />
      <PatientPanel
        patient={selectedConversation?.patient ?? null}
        upcomingAppointment={selectedConversation?.upcomingAppointment ?? null}
      />
    </div>
  );
}
