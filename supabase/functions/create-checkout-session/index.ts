import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const PRICE_MAP: Record<string, string> = {
  per_event: "price_1TKeZXFqx3S6pU817FQSrnh9",
  event_planner: "price_1TKebbFqx3S6pU81j5eHBLwn",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tier, return_url } = await req.json();

    if (!tier || !PRICE_MAP[tier]) {
      return new Response(
        JSON.stringify({ error: "Invalid tier. Use 'per_event' or 'event_planner'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is already authenticated
    const authHeader = req.headers.get("Authorization");
    let customerEmail: string | undefined;
    let userId: string | undefined;

    if (authHeader) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        customerEmail = user.email;
        userId = user.id;
      }
    }

    const mode = tier === "event_planner" ? "subscription" : "payment";
    const successUrl = `${return_url || "https://placecard.com"}?checkout=success&tier=${tier}`;
    const cancelUrl = `${return_url || "https://placecard.com"}?checkout=canceled`;

    // Build form-encoded body for Stripe API
    const params = new URLSearchParams();
    params.append("mode", mode);
    params.append("payment_method_types[0]", "card");
    params.append("line_items[0][price]", PRICE_MAP[tier]);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("metadata[tier]", tier);
    if (userId) params.append("metadata[user_id]", userId);
    if (customerEmail) params.append("customer_email", customerEmail);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: data.error?.message || "Stripe error" }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ url: data.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
