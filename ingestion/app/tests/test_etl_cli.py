"""CLI contract for the ETL loaders: no hardcoded semester or file path.

These run without a database. They cover only argument parsing and how the
semester is resolved. The SQL is exercised by running the loaders against a
real Postgres.
"""
import pytest

from database import load_courses, load_profs
from database.load_courses import resolve_semester


# ─── resolve_semester ─────────────────────────────────────────────────────────

def test_semester_comes_from_filename():
    assert resolve_semester("app/scraped_data/usc_20261_courses.json") == "20261"


def test_explicit_semester_used_when_filename_has_none():
    assert resolve_semester("/tmp/catalog.json", "20262") == "20262"


def test_explicit_semester_matching_filename_is_fine():
    assert resolve_semester("usc_20263_courses.json", "20263") == "20263"


def test_explicit_semester_disagreeing_with_filename_is_an_error():
    with pytest.raises(ValueError, match="disagrees"):
        resolve_semester("usc_20261_courses.json", "20263")


def test_digits_in_directory_names_are_ignored():
    # A timestamped run directory must not be mistaken for the term code.
    # Searching the whole path would return '202611' here.
    assert resolve_semester("runs/20261104/usc_20261_courses.json") == "20261"


def test_no_semester_anywhere_is_an_error():
    with pytest.raises(ValueError, match="Could not determine"):
        resolve_semester("runs/20261104/catalog.json")


def test_six_digit_code_in_filename_is_rejected():
    with pytest.raises(ValueError, match="5-digit"):
        resolve_semester("usc_202611_courses.json")


# ─── argument parsing ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("module", [load_courses, load_profs])
def test_json_file_is_required(module):
    with pytest.raises(SystemExit):
        module.parse_args([])


def test_load_courses_args():
    args = load_courses.parse_args(["--json-file", "x/usc_20261_courses.json", "--semester", "20261"])
    assert args.json_file == "x/usc_20261_courses.json"
    assert args.semester == "20261"


def test_load_courses_semester_is_optional():
    assert load_courses.parse_args(["--json-file", "f.json"]).semester is None


def test_load_profs_args():
    assert load_profs.parse_args(["--json-file", "f.json"]).json_file == "f.json"
