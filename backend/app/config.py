from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "AI Event Planning"
    database_url: str = "sqlite:///./event_planning.db"
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/google/callback"
    secret_key: str = "dev-secret-key-change-in-production"
    frontend_url: str = "http://localhost:5173"
    supabase_url: str = ""
    supabase_service_key: str = ""
    # Supabase project JWT secret — used by auth.py to verify the
    # Authorization Bearer tokens that the frontend sends. Find it in
    # Supabase → Settings → API → JWT Secret. Required when
    # require_auth=true.
    supabase_jwt_secret: str = ""
    # Master gate for the JWT auth dependency. Defaults to off so local
    # development isn't broken by missing tokens. Production sets this
    # to "true" via Render env vars; staging/preview can stay off.
    require_auth: bool = False
    fourover_api_key: str = ""
    fourover_private_key: str = ""
    fourover_mode: str = "sandbox"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""
    twilio_whatsapp_number: str = ""
    google_places_api_key: str = ""
    resend_api_key: str = ""
    resend_from_email: str = "events@placecard-events.app"
    gemini_api_key: str = ""
    # Stripe — print-order checkout. Test keys (sk_test_..., whsec_...)
    # are fine for the build; flip to live keys at launch deliberately.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    # Fulfillment notifications land here. Manual print workflow until
    # automated print-vendor integration arrives.
    fulfillment_email: str = "ahoy@hazardhouse.co"
    # Comma-separated list of origins allowed by CORS. Local dev defaults
    # to the Vite ports; production overrides via env var to the deployed
    # frontend domain(s) (e.g. "https://app.placecard-events.app").
    allowed_origins: str = "http://localhost:5173,http://localhost:5180"

    model_config = {"env_file": ".env"}


settings = Settings()
