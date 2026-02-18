import type {
  ClinicLocation,
  Conversation,
  ConversationWithDetails,
} from "@/types";

/** Backend base URL. When set, requests go through /api/backend/* proxy (see next.config rewrites). */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Fetches from the backend via the Next.js proxy when API_BASE_URL is set.
 * Request to /api/backend/conversations is rewritten to ${NEXT_PUBLIC_API_URL}/conversations.
 */
async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const url = API_BASE_URL ? `/api/backend${path.startsWith("/") ? path : `/${path}`}` : "";
  if (!url) {
    throw new Error("API base URL is not set");
  }
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Placeholder: returns mocked conversations when NEXT_PUBLIC_API_URL is unset. Uses proxy when set. */
export async function getInboxConversations(): Promise<Conversation[]> {
  if (API_BASE_URL) {
    return fetchApi<Conversation[]>("/conversations");
  }
  return getMockConversations();
}

/** Placeholder: returns mocked conversation by id when NEXT_PUBLIC_API_URL is unset. Uses proxy when set. */
export async function getConversationById(
  id: string
): Promise<ConversationWithDetails | null> {
  if (API_BASE_URL) {
    return fetchApi<ConversationWithDetails | null>(`/conversations/${id}`);
  }
  return getMockConversationById(id);
}

/** Placeholder: returns mocked clinic locations when NEXT_PUBLIC_API_URL is unset. Uses proxy when set. */
export async function getClinicLocations(): Promise<ClinicLocation[]> {
  if (API_BASE_URL) {
    return fetchApi<ClinicLocation[]>("/locations");
  }
  return getMockLocations();
}

// —— Mock data (used when NEXT_PUBLIC_API_URL is not set) ——

function getMockLocations(): ClinicLocation[] {
  return [
    { id: "loc-1", name: "Downtown Clinic", timezone: "America/New_York" },
    { id: "loc-2", name: "Westside Medical", timezone: "America/Los_Angeles" },
  ];
}

function getMockConversations(): Conversation[] {
  const patients = getMockPatients();
  return [
    {
      id: "conv-1",
      patientId: "p-1",
      channel: "whatsapp",
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: "Yes, I can make 2pm tomorrow.",
      unreadCount: 2,
      patient: patients[0],
      assignment: "You",
    },
    {
      id: "conv-2",
      patientId: "p-2",
      channel: "sms",
      lastMessageAt: new Date(Date.now() - 3600000).toISOString(),
      lastMessagePreview: "Need to reschedule my appointment",
      unreadCount: 0,
      patient: patients[1],
    },
    {
      id: "conv-3",
      patientId: "p-3",
      channel: "email",
      lastMessageAt: new Date(Date.now() - 86400000).toISOString(),
      lastMessagePreview: "Confirming my visit on Friday",
      unreadCount: 1,
      patient: patients[2],
    },
  ];
}

function getMockPatients() {
  return [
    {
      id: "p-1",
      name: "Jane Smith",
      phone: "+1 555-0101",
      email: "jane@example.com",
      tags: ["VIP"],
      noShowRisk: "LOW" as const,
    },
    {
      id: "p-2",
      name: "John Doe",
      phone: "+1 555-0102",
      tags: ["urgent"],
      noShowRisk: "MEDIUM" as const,
    },
    {
      id: "p-3",
      name: "Maria Garcia",
      phone: "+1 555-0103",
      tags: ["post-op"],
      noShowRisk: "HIGH" as const,
    },
  ];
}

function getMockConversationById(
  id: string
): Promise<ConversationWithDetails | null> {
  const patients = getMockPatients();
  const convs = getMockConversations();
  const conv = convs.find((c) => c.id === id);
  if (!conv) return Promise.resolve(null);

  const patient = conv.patient ?? patients[0];
  const messages = [
    {
      id: "m-1",
      conversationId: id,
      channel: conv.channel,
      direction: "inbound" as const,
      body: "Hi, I need to confirm my appointment for tomorrow.",
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      read: true,
    },
    {
      id: "m-2",
      conversationId: id,
      channel: conv.channel,
      direction: "outbound" as const,
      body: "Sure! Your appointment is at 2:00 PM. Would you like to confirm or reschedule?",
      timestamp: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: "m-3",
      conversationId: id,
      channel: conv.channel,
      direction: "inbound" as const,
      body: conv.lastMessagePreview ?? "Yes, I can make 2pm tomorrow.",
      timestamp: conv.lastMessageAt,
      read: false,
    },
  ];

  return Promise.resolve({
    ...conv,
    messages,
    patient,
    upcomingAppointment: {
      id: "apt-1",
      patientId: patient.id,
      locationId: "loc-1",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      status: "scheduled",
      serviceName: "Annual checkup",
    },
  });
}
