"""Alembic environment.

Wires Alembic to the same SQLAlchemy metadata (`app.database.Base`) that
the runtime FastAPI app uses, and to the same `DATABASE_URL` from
`app.config.settings`. This is the only place migrations need to know
about the app's models.

Importing the model packages here is intentional: it has the side effect
of registering every model class against `Base.metadata`, which is what
Alembic's `--autogenerate` walks to diff schema vs. database.
"""
import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# Ensure `app/` is importable. The `alembic` console script doesn't put
# the cwd on sys.path the way `python -m alembic` does — without this,
# `from app.config import settings` fails in production environments
# (Render) where the bare `alembic` command runs the migration.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Bring the app's runtime configuration into Alembic's world.
from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402

# Import the model packages purely for the metadata-registration side
# effect. `# noqa: F401` because the names aren't otherwise used here.
from app.models import event, attendee, table, seating, google_form, schedule  # noqa: F401, E402
from app.models import notification, custom_form  # noqa: F401, E402

# Alembic Config object — gives access to alembic.ini values.
config = context.config

# Apply the runtime DATABASE_URL onto the config so engine_from_config
# below picks it up. `_apply_psycopg_scheme` mirrors the same scheme
# rewrite that app/database.py does for `postgresql://` URLs.
def _apply_psycopg_scheme(url: str) -> str:
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    return url


config.set_main_option("sqlalchemy.url", _apply_psycopg_scheme(settings.database_url))

# Set up Python logging using the alembic.ini config (if present).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata Alembic compares against the live DB for autogenerate.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Render migration SQL without a live DB connection.

    Useful for generating SQL the team can review before applying.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against the database referenced by sqlalchemy.url."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
