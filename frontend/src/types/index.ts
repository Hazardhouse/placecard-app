export interface Event {
  id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  venue: string | null;
  venue_type: string | null;
  event_category: string | null;
  description: string | null;
  created_at: string;
  attendee_count: number;
  public_token: string | null;
  image_data: string | null;
  salon_id: number | null;
}

export interface Attendee {
  id: number;
  event_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  dietary_requirements: string | null;
  responses: Record<string, string> | null;
  notes: string | null;
  rsvp_status: string;
  google_form_response_id: string | null;
  created_at: string;
}

export interface Table {
  id: number;
  event_id: number;
  name: string;
  shape: "round" | "rectangular" | "oval" | "chair-row" | "custom";
  width: number;
  height: number;
  capacity: number;
  x_position: number;
  y_position: number;
  rotation: number;
}

export interface SeatAssignment {
  id: number;
  arrangement_id: number;
  attendee_id: number;
  table_id: number;
  seat_number: number;
  attendee?: Attendee;
  table?: Table;
}

export interface SeatingArrangement {
  id: number;
  event_id: number;
  name: string;
  created_at: string;
  seat_assignments: SeatAssignment[];
}

export interface CustomFormField {
  id: string;
  type: "text" | "dropdown" | "multiple_choice" | "checkbox" | "textarea";
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export interface CustomForm {
  id: number;
  event_id: number;
  title: string;
  description: string | null;
  fields: CustomFormField[];
  share_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomFormPublic {
  title: string;
  description: string | null;
  fields: CustomFormField[];
  event_name: string;
  event_date: string | null;
  event_location: string | null;
  is_active: boolean;
}

export interface FormInvitation {
  id: number;
  form_id: number;
  email: string;
  sent_at: string | null;
  status: string;
}

export interface MealOptions {
  entrees: string[];
  mains: string[];
  desserts: string[];
  drinks: string[];
}

export interface ScheduleItem {
  id: number;
  event_id: number;
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_type: string | null;
  location: string | null;
  notes: string | null;
  requires_seating: boolean;
  assigned_to: string | null;
  assign_notes: string | null;
  meal_options: MealOptions | null;
  sort_order: number;
  created_at: string;
}
