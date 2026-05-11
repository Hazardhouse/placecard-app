import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
);

const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generate a short unique referral code (8 chars)
function generateReferralCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, full_name, wants_referral, referred_by } = await req.json();

    if (!email || !full_name) {
      return new Response(
        JSON.stringify({ error: "Name and email are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if email already exists
    const { data: existing } = await supabaseAdmin
      .from("waitlist_signups")
      .select("referral_code, wants_referral")
      .eq("email", email)
      .single();

    if (existing) {
      return new Response(
        JSON.stringify({
          message: "You're already on the waitlist!",
          referral_code: existing.wants_referral ? existing.referral_code : null,
          referral_url: existing.wants_referral
            ? `https://placecard-events.app?ref=${existing.referral_code}`
            : null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate unique referral code
    let referralCode = generateReferralCode();
    let attempts = 0;
    while (attempts < 5) {
      const { data: collision } = await supabaseAdmin
        .from("waitlist_signups")
        .select("id")
        .eq("referral_code", referralCode)
        .single();
      if (!collision) break;
      referralCode = generateReferralCode();
      attempts++;
    }

    // Validate referred_by code if provided
    let validReferrer: string | null = null;
    if (referred_by) {
      const { data: referrer } = await supabaseAdmin
        .from("waitlist_signups")
        .select("referral_code")
        .eq("referral_code", referred_by)
        .single();
      if (referrer) {
        validReferrer = referred_by;
      }
    }

    // Insert signup
    const { error: insertError } = await supabaseAdmin
      .from("waitlist_signups")
      .insert({
        email,
        full_name,
        referral_code: referralCode,
        referred_by: validReferrer,
        wants_referral: wants_referral || false,
      });

    if (insertError) {
      console.error("Insert error:", insertError.message);
      return new Response(
        JSON.stringify({ error: "Failed to join waitlist. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Also add to email subscribers list
    await supabaseAdmin
      .from("email_subscribers")
      .upsert(
        {
          email,
          full_name,
          subscribed: true,
          source: "waitlist",
        },
        { onConflict: "email" }
      );

    // Send confirmation email via Resend
    const referralUrl = wants_referral
      ? `https://placecard-events.app?ref=${referralCode}`
      : null;

    const referralBlock = referralUrl
      ? `<div style="margin-top:24px;padding:20px;background:#f8fafc;border-radius:12px;">
           <p style="margin:0 0 8px;font-weight:600;color:#1e293b;">Your referral link:</p>
           <p style="margin:0 0 12px;"><a href="${referralUrl}" style="color:#1b4fff;word-break:break-all;">${referralUrl}</a></p>
           <p style="margin:0;font-size:14px;color:#64748b;">Share this link — you'll earn <strong>15% commission</strong> when someone signs up for a paid plan.</p>
         </div>`
      : "";

    if (resendApiKey) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "PlaceCard <hello@placecard-events.app>",
            to: email,
            subject: "You're on the PlaceCard waitlist!",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;"><img src="https://placecard-events.app/logo.svg" alt="PlaceCard" style="height:36px;margin-bottom:32px;" /><h1 style="font-size:24px;font-weight:700;color:#1e293b;margin:0 0 8px;">Welcome, ${full_name}!</h1><p style="font-size:16px;color:#475569;line-height:1.6;margin:0 0 16px;">You're on the waitlist for PlaceCard — the event pipeline that runs itself. We'll let you know as soon as it's ready.</p>${referralBlock}<p style="margin-top:32px;font-size:14px;color:#94a3b8;">— The PlaceCard Team</p></div>`,
          }),
        });
        const emailData = await emailRes.text();
        console.log("Resend response:", emailRes.status, emailData);
      } catch (emailErr) {
        console.error("Failed to send confirmation email:", emailErr);
      }
    } else {
      console.warn("RESEND_API_KEY not set, skipping confirmation email");
    }

    const response: Record<string, unknown> = {
      message: "You're on the waitlist!",
      referral_code: wants_referral ? referralCode : null,
      referral_url: referralUrl,
    };

    return new Response(
      JSON.stringify(response),
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
