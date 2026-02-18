/** Channel types for omnichannel inbox */
export type ChannelType = "sms" | "whatsapp" | "email";

/** No-show risk level (87%+ accuracy displayed in UI) */
export type NoShowRiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** Patient/conversation tags */
export type ConversationTag = "VIP" | "urgent" | "post-op" | string;

export interface ClinicLocation {
  id: string;
  name: string;
  address?: string;
  timezone: string;
}

export interface Message {
  id: string;
  conversationId: string;
  channel: ChannelType;
  direction: "inbound" | "outbound";
  body: string;
  timestamp: string;
  read?: boolean;
}

export interface Patient {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  tags: ConversationTag[];
  noShowRisk?: NoShowRiskLevel;
}

export interface Appointment {
  id: string;
  patientId: string;
  locationId: string;
  scheduledAt: string;
  status: "scheduled" | "confirmed" | "cancelled" | "completed" | "no-show";
  serviceName?: string;
}

export interface Conversation {
  id: string;
  patientId: string;
  channel: ChannelType;
  lastMessageAt: string;
  lastMessagePreview?: string;
  unreadCount: number;
  patient?: Patient;
  assignment?: string;
}

export interface ConversationWithDetails extends Conversation {
  messages: Message[];
  patient: Patient;
  upcomingAppointment?: Appointment;
}
