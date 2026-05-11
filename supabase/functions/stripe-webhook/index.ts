import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-04-10",
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SERVICE_ROLE_KEY")!
);

const PRICE_TO_TIER: Record<string, string> = {
  "price_1TKeZXFqx3S6pU817FQSrnh9": "per_event",
  "price_1TKebbFqx3S6pU81j5eHBLwn": "event_planner",
};

// ── Send welcome email via Resend ──
async function sendWelcomeEmail(email: string, name: string, tier: string, tempPassword: string) {
  const tierLabel = tier === "per_event" ? "Per Event" : "Event Planner";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "PlaceCard <hello@placecard.com>",
      to: [email],
      subject: `Welcome to PlaceCard — Your ${tierLabel} plan is active`,
      html: `
        <div style="font-family: 'Inter', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px;">
          <h1 style="font-size: 24px; color: #0f172a; margin-bottom: 8px;">Welcome to PlaceCard</h1>
          <p style="color: #64748b; font-size: 15px; line-height: 1.6;">
            Hi ${name || "there"}, your <strong>${tierLabel}</strong> plan is now active.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 24px 0;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #64748b;">Your login credentials:</p>
            <p style="margin: 0; font-size: 15px;"><strong>Email:</strong> ${email}</p>
            <p style="margin: 4px 0 0; font-size: 15px;"><strong>Temporary password:</strong> ${tempPassword}</p>
          </div>
          <a href="https://app.placecard.com/login"
             style="display: inline-block; background: #1b4fff; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
            Log In to PlaceCard
          </a>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 32px;">
            Please change your password after your first login.
          </p>
        </div>
      `,
    }),
  });
}

// ── Add to email subscriber list ──
async function addToEmailList(email: string, name: string, userId: string | null) {
  await supabaseAdmin
    .from("email_subscribers")
    .upsert(
      {
        email,
        full_name: name,
        user_id: userId,
        subscribed: true,
        source: "checkout",
      },
      { onConflict: "email" }
    );
}

// ── Generate a random temporary password ──
function generateTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}

// ── Handle checkout.session.completed ──
async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const email = session.customer_details?.email || session.customer_email;
  const name = session.customer_details?.name || "";
  const tier = session.metadata?.tier || "per_event";
  const existingUserId = session.metadata?.user_id;

  if (!email) {
    console.error("No email found in checkout session");
    return;
  }

  let userId = existingUserId;

  // If no existing user, create one in Supabase Auth
  if (!userId) {
    const tempPassword = generateTempPassword();

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: name },
    });

    if (authError) {
      // User might already exist — look them up
      if (authError.message.includes("already been registered")) {
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existing = existingUsers?.users?.find((u) => u.email === email);
        if (existing) {
          userId = existing.id;
        }
      } else {
        console.error("Error creating user:", authError.message);
        return;
      }
    } else if (authData.user) {
      userId = authData.user.id;
      // Send welcome email with temp credentials
      await sendWelcomeEmail(email, name, tier, tempPassword);
    }
  }

  if (!userId) {
    console.error("Could not resolve user ID");
    return;
  }

  // Retrieve Stripe customer ID
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  // Update subscription record
  const subscriptionData: Record<string, unknown> = {
    tier,
    stripe_customer_id: customerId,
    stripe_price_id: session.metadata?.price_id || null,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  // For recurring subscriptions, store subscription ID and period
  if (session.subscription) {
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;

    const sub = await stripe.subscriptions.retrieve(subId);
    subscriptionData.stripe_subscription_id = subId;
    subscriptionData.current_period_start = new Date(sub.current_period_start * 1000).toISOString();
    subscriptionData.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
  }

  await supabaseAdmin
    .from("subscriptions")
    .update(subscriptionData)
    .eq("user_id", userId);

  // Add to mailing list
  await addToEmailList(email, name, userId);
}

// ── Handle subscription canceled/expired ──
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "canceled",
      tier: "free",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId);
}

// ── Handle subscription updated (e.g. past_due, plan change) ──
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const priceId = subscription.items.data[0]?.price?.id;
  const tier = priceId ? PRICE_TO_TIER[priceId] || "event_planner" : "event_planner";

  await supabaseAdmin
    .from("subscriptions")
    .update({
      tier,
      status: subscription.status === "active" ? "active" : subscription.status,
      stripe_price_id: priceId,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId);
}

// ── Main handler ──
serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
