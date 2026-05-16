import { supabase } from "../lib/supabase";

// API base URL. In production, set VITE_API_URL on the hosting platform
// (Cloudflare Pages env vars) to e.g. "https://api.placecard-events.app/api".
// In local dev, falls back to the local FastAPI server.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Events
  listEvents: () => request<import("../types").Event[]>("/events"),
  createEvent: (data: Partial<import("../types").Event>) =>
    request<import("../types").Event>("/events", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getEvent: (id: number) => request<import("../types").Event>(`/events/${id}`),
  updateEvent: (id: number, data: Partial<import("../types").Event>) =>
    request<import("../types").Event>(`/events/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteEvent: (id: number) =>
    request<void>(`/events/${id}`, { method: "DELETE" }),
  duplicateEvent: (id: number) =>
    request<import("../types").Event>(`/events/${id}/duplicate`, { method: "POST" }),

  // Saved designs — persists generated name-card / program sets per event
  // so they survive navigation, refresh, and session timeouts. Without
  // this, every page load would regenerate against Gemini and burn budget.
  listDesigns: (eventId: number) =>
    request<Record<string, {
      image_b64: string;
      mime_type: string;
      description: string | null;
      views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
    }[]>>(`/events/${eventId}/designs`),
  // Append a freshly-generated set to the existing designs for one
  // content_type. New designs land alongside the prior ones, not
  // replacing them — the user accumulates variations across Create
  // clicks instead of losing them. This is the post-generation path.
  appendDesigns: (
    eventId: number,
    contentType: string,
    designs: {
      image_b64: string;
      mime_type: string;
      description: string | null;
      views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
    }[],
  ) =>
    request<{
      image_b64: string;
      mime_type: string;
      description: string | null;
      views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
    }[]>(`/events/${eventId}/designs`, {
      method: "POST",
      body: JSON.stringify({ content_type: contentType, designs }),
    }),
  // Replace (clear + repopulate) the entire set for one content_type.
  // Not used by the post-generation flow — kept for an explicit
  // "start over" action when one's added later.
  replaceDesigns: (
    eventId: number,
    contentType: string,
    designs: {
      image_b64: string;
      mime_type: string;
      description: string | null;
      views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
    }[],
  ) =>
    request<{
      image_b64: string;
      mime_type: string;
      description: string | null;
      views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
    }[]>(`/events/${eventId}/designs`, {
      method: "PUT",
      body: JSON.stringify({ content_type: contentType, designs }),
    }),
  clearDesigns: (eventId: number, contentType?: string) =>
    request<void>(
      `/events/${eventId}/designs${contentType ? `?content_type=${encodeURIComponent(contentType)}` : ""}`,
      { method: "DELETE" },
    ),

  // Public event page (no auth required)
  getPublicEvent: (token: string) =>
    request<import("../types").Event>(`/public-event/${token}`),

  // Attendees
  listAttendees: (eventId: number) =>
    request<import("../types").Attendee[]>(`/events/${eventId}/attendees`),
  createAttendee: (eventId: number, data: Partial<import("../types").Attendee>) =>
    request<import("../types").Attendee>(`/events/${eventId}/attendees`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAttendee: (eventId: number, id: number, data: Partial<import("../types").Attendee>) =>
    request<import("../types").Attendee>(`/events/${eventId}/attendees/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteAttendee: (eventId: number, id: number) =>
    request<void>(`/events/${eventId}/attendees/${id}`, { method: "DELETE" }),

  // Tables
  listTables: (eventId: number) =>
    request<import("../types").Table[]>(`/events/${eventId}/tables`),
  createTable: (eventId: number, data: Partial<import("../types").Table>) =>
    request<import("../types").Table>(`/events/${eventId}/tables`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTable: (eventId: number, id: number, data: Partial<import("../types").Table>) =>
    request<import("../types").Table>(`/events/${eventId}/tables/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteTable: (eventId: number, id: number) =>
    request<void>(`/events/${eventId}/tables/${id}`, { method: "DELETE" }),

  // Seating
  listArrangements: (eventId: number) =>
    request<import("../types").SeatingArrangement[]>(`/events/${eventId}/seating`),
  createArrangement: (eventId: number, data: { name: string }) =>
    request<import("../types").SeatingArrangement>(`/events/${eventId}/seating`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getArrangement: (eventId: number, id: number) =>
    request<import("../types").SeatingArrangement>(`/events/${eventId}/seating/${id}`),
  updateArrangement: (eventId: number, id: number, data: { name?: string }) =>
    request<import("../types").SeatingArrangement>(`/events/${eventId}/seating/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteArrangement: (eventId: number, id: number) =>
    request<void>(`/events/${eventId}/seating/${id}`, { method: "DELETE" }),
  assignSeat: (eventId: number, arrangementId: number, data: { attendee_id: number; table_id: number; seat_number: number }) =>
    request<import("../types").SeatAssignment>(`/events/${eventId}/seating/${arrangementId}/seats`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  removeSeat: (eventId: number, arrangementId: number, assignmentId: number) =>
    request<void>(`/events/${eventId}/seating/${arrangementId}/seats/${assignmentId}`, {
      method: "DELETE",
    }),

  // Schedule
  listSchedule: (eventId: number) =>
    request<import("../types").ScheduleItem[]>(`/events/${eventId}/schedule`),
  createScheduleItem: (eventId: number, data: Partial<import("../types").ScheduleItem>) =>
    request<import("../types").ScheduleItem>(`/events/${eventId}/schedule`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateScheduleItem: (eventId: number, itemId: number, data: Partial<import("../types").ScheduleItem>) =>
    request<import("../types").ScheduleItem>(`/events/${eventId}/schedule/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteScheduleItem: (eventId: number, itemId: number) =>
    request<void>(`/events/${eventId}/schedule/${itemId}`, { method: "DELETE" }),

  // Print checkout — pricing-from-pricing.py + Stripe PaymentIntents.
  // Manual fulfillment after webhook fires on payment_intent.succeeded.
  getPrintQuote: (data: {
    country?: string;
    content_type?: "tented-name-cards" | "name-cards" | "programs";
    quantity: number;
    paper_stock?: string;
    finish?: string;
    color_spec?: string;
    rush?: boolean;
    remove_branding?: boolean;
  }) =>
    request<{
      country: string;
      currency: string;
      quantity_tier: number;
      base_amount: number;
      rush_amount: number;
      remove_branding_amount: number;
      shipping_amount: number;
      total_amount: number;
    }>("/print/quote", { method: "POST", body: JSON.stringify(data) }),

  // Create a Stripe PaymentIntent for a print order. Server computes
  // the authoritative amount from pricing.py — client-sent totals are
  // ignored. Returns the client_secret to hand to Stripe.js for the
  // embedded card form.
  createPrintIntent: (data: {
    event_id: number;
    content_type: "tented-name-cards" | "name-cards" | "programs";
    quantity: number;
    paper_stock?: string;
    finish?: string;
    color_spec?: string;
    turnaround_days?: number;
    rush?: boolean;
    remove_branding?: boolean;
    design: {
      image_b64: string;
      mime_type: string;
      description?: string | null;
      views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
    };
    attendees: { name: string; table_name?: string | null; dietary?: string | null }[];
    shipping: {
      name: string;
      email: string;
      company?: string | null;
      address1: string;
      address2?: string | null;
      city: string;
      state?: string | null;
      zip: string;
      country: "US" | "GB";
    };
  }) =>
    request<{
      client_secret: string;
      order_id: number;
      total_amount_cents: number;
      currency: string;
    }>("/print/checkout/create-intent", { method: "POST", body: JSON.stringify(data) }),

  // Used by the success page to confirm the order's status after the
  // PaymentElement reports success — the webhook on the server side
  // is what actually flips status to 'paid', so we poll this briefly.
  getPrintOrder: (orderId: number) =>
    request<{
      id: number;
      status: string;
      total_amount_cents: number;
      currency: string;
      content_type: string;
      quantity: number;
      quantity_tier: number;
      created_at: string;
      paid_at: string | null;
    }>(`/print/orders/${orderId}`),

  extractBrandColors: (url: string) =>
    request<{
      colors: { hex: string; role: string; label: string }[];
      font: string | null;
      source_url: string;
    }>("/brand/extract-colors", { method: "POST", body: JSON.stringify({ url }) }),

  generateNameCards: (data: {
    event_type: string;
    content_type?: "tented-name-cards" | "name-cards" | "programs";
    brand_colors?: string[];
    brand_font?: string | null;
    event_name?: string | null;
    prompt?: string;
    sample_guest_name?: string | null;
    sample_guest_table?: string | null;
    sample_guest_dietary?: string | null;
    sample_guest_meal?: {
      venue: string;
      entree?: string;
      main?: string;
      dessert?: string;
      drink?: string;
    } | null;
    schedule_items?: {
      title: string;
      description: string | null;
      start_time: string | null;
      end_time: string | null;
      venue_name: string | null;
      location: string | null;
    }[];
  }) =>
    request<{
      designs: {
        image_b64: string;
        mime_type: string;
        description: string | null;
        views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
      }[];
      model_used: string;
    }>("/cards/generate", { method: "POST", body: JSON.stringify(data) }),

  // Notification Settings
  getNotificationSettings: () =>
    request<any>("/settings/notifications"),
  updateNotificationSettings: (data: any) =>
    request<any>("/settings/notifications", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  // Places autocomplete
  placesAutocomplete: (q: string, types?: string) =>
    request<{ predictions: { place_id: string; description: string; main_text: string; secondary_text: string }[] }>(
      `/places/autocomplete?q=${encodeURIComponent(q)}${types ? `&types=${types}` : ""}`,
    ),
  placesNearby: (location: string) =>
    request<{ results: { place_id: string; name: string; address: string; rating?: number }[] }>(
      `/places/nearby?location=${encodeURIComponent(location)}`,
    ),
  // Static map proxy URL — used directly as <img src>. No request() call
  // needed since the response is a PNG; the proxy keeps the API key
  // server-side and adds 24h cache headers.
  placesStaticMapUrl: (q: string, width = 600, height = 300) =>
    `${API_BASE}/places/static-map?q=${encodeURIComponent(q)}&width=${width}&height=${height}`,

  getMessageUsage: () =>
    request<{ sms_used: number; sms_limit: number; whatsapp_used: number; whatsapp_limit: number; plan: string }>(
      "/settings/message-usage",
    ),

  // Custom Forms
  listForms: (eventId: number) =>
    request<import("../types").CustomForm[]>(`/events/${eventId}/forms`),
  createForm: (eventId: number, data: { title: string; description?: string; fields: import("../types").CustomFormField[] }) =>
    request<import("../types").CustomForm>(`/events/${eventId}/forms`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getForm: (eventId: number, formId: number) =>
    request<import("../types").CustomForm>(`/events/${eventId}/forms/${formId}`),
  updateForm: (eventId: number, formId: number, data: Partial<import("../types").CustomForm>) =>
    request<import("../types").CustomForm>(`/events/${eventId}/forms/${formId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteForm: (eventId: number, formId: number) =>
    request<void>(`/events/${eventId}/forms/${formId}`, { method: "DELETE" }),
  sendFormInvitations: (eventId: number, formId: number, emails: string[]) =>
    request<import("../types").FormInvitation[]>(`/events/${eventId}/forms/${formId}/send`, {
      method: "POST",
      body: JSON.stringify({ emails }),
    }),
  listFormInvitations: (eventId: number, formId: number) =>
    request<import("../types").FormInvitation[]>(`/events/${eventId}/forms/${formId}/invitations`),
  getPublicForm: (shareToken: string) =>
    request<import("../types").CustomFormPublic>(`/forms/${shareToken}`),
  submitPublicForm: (shareToken: string, data: any) =>
    request<{ message: string; attendee_id: number }>(`/forms/${shareToken}/submit`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Restaurant share link (authenticated) — variant is "attendees" or "seating"
  getRestaurantLink: (eventId: number, variant: "attendees" | "seating") =>
    request<{ variant: string; share_token: string | null; share_url: string | null }>(
      `/events/${eventId}/restaurant-link/${variant}`,
    ),
  generateRestaurantLink: (eventId: number, variant: "attendees" | "seating") =>
    request<{ variant: string; share_token: string; share_url: string }>(
      `/events/${eventId}/restaurant-link/${variant}`,
      { method: "POST" },
    ),
  revokeRestaurantLink: (eventId: number, variant: "attendees" | "seating") =>
    request<void>(`/events/${eventId}/restaurant-link/${variant}`, { method: "DELETE" }),
  sendRestaurantLink: (
    eventId: number,
    variant: "attendees" | "seating",
    data: {
      emails: string[];
      organizer_name: string;
      organizer_email?: string;
      message?: string;
    },
  ) =>
    request<{ sent: string[]; failed: string[]; share_url: string }>(
      `/events/${eventId}/restaurant-link/${variant}/send`,
      { method: "POST", body: JSON.stringify(data) },
    ),

  // Public restaurant view (no auth required)
  getRestaurantView: (variant: "attendees" | "seating", shareToken: string) =>
    request<{
      variant: "attendees" | "seating";
      event_name: string;
      event_date: string | null;
      event_location: string | null;
      total_attendees: number;
      confirmed_count: number;
      pending_count: number;
      declined_count: number;
      dietary_breakdown: { label: string; icon: string; count: number }[];
      attendees: { name: string; dietary: string | null }[];
      arrangements: {
        id: number;
        name: string;
        tables: {
          id: number;
          name: string;
          shape: string | null;
          capacity: number;
          seats: {
            seat_number: number;
            attendee_name: string | null;
            dietary: string | null;
          }[];
          x_position: number;
          y_position: number;
          width: number;
          height: number;
          rotation: number;
        }[];
        meal_totals?: {
          venue: string;
          total_guests: number;
          courses: {
            course: string;
            totals: { option: string; count: number }[];
          }[];
        }[];
      }[];
    }>(`/restaurant-view/${variant}/${shareToken}`),

  // Document import — backend extracts table rows from a PDF.
  // The frontend then runs each row through `rowToAttendee` like any other
  // CSV/XLSX upload. We bypass the JSON `request` helper because this is a
  // multipart upload.
  parsePdfTable: async (file: File) => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/parse-pdf-table`, {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(error.detail || res.statusText);
    }
    return res.json() as Promise<{ headers: string[]; rows: Record<string, string>[] }>;
  },
};
