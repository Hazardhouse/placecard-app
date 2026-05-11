from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# Engine configuration is dialect-dependent:
#   - SQLite (local dev): needs `check_same_thread=False` so multiple
#     request threads can share the connection.
#   - Postgres (production via Supabase): use a pool sized for Render
#     Starter's 512MB RAM and Supabase Free's connection limit (60).
#     `pool_pre_ping` recycles dead connections after Supabase's idle
#     timeout so the first request after a quiet period doesn't 500.
_db_url = settings.database_url
# Supabase provides connection strings as `postgresql://...`, which routes
# to the legacy psycopg2 driver by default. We're on psycopg 3.x — rewrite
# the scheme so SQLAlchemy picks the right dialect.
if _db_url.startswith("postgresql://"):
    _db_url = "postgresql+psycopg://" + _db_url[len("postgresql://"):]
elif _db_url.startswith("postgres://"):
    # Some providers still use the old `postgres://` scheme (Heroku-era).
    _db_url = "postgresql+psycopg://" + _db_url[len("postgres://"):]

if _db_url.startswith("sqlite"):
    engine = create_engine(
        _db_url,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        _db_url,
        pool_size=5,
        max_overflow=5,
        pool_pre_ping=True,
        pool_recycle=300,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
