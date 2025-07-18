from backend.app.scrapers.usc_courses import crawl_term
from backend.app.services.loader import bulk_upsert_sections
from backend.app.core.database import get_session  # your sync factory

sections = crawl_term(term_code)
with get_session() as db:
    bulk_upsert_sections(db, term_code, sections)