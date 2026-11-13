import argparse
import json
import os
import psycopg2
import re

def extract_semester_from_filename(filename):
    match = re.search(r'(\d{5,6})', filename)
    return match.group(1) if match else None

def resolve_semester(json_file, semester_arg=None):
    """Work out which USC term code to load the catalog under.

    The term code comes from --semester if given, otherwise from the JSON's
    *basename* (usc_<term>_courses.json). The directory is never searched: a
    path like runs/20261104/usc_20261_courses.json would otherwise match
    '202611', and the courses would load under a semester the API never asks
    for, which fails silently. If --semester and the filename disagree, that is
    an error, not a tie-break.
    """
    from_filename = extract_semester_from_filename(os.path.basename(json_file))
    if semester_arg and from_filename and semester_arg != from_filename:
        raise ValueError(
            f"--semester {semester_arg} disagrees with the term code in the filename "
            f"({from_filename}): {json_file}"
        )
    semester = semester_arg or from_filename
    if not semester:
        raise ValueError(
            f"Could not determine the semester for {json_file}: pass --semester, "
            f"or name the file usc_<term>_courses.json"
        )
    if not re.fullmatch(r'\d{5}', semester):
        raise ValueError(f"Semester must be a 5-digit USC term code like 20261, got {semester!r}")
    return semester

def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="Upsert a scraped USC course catalog into the courses and sections tables."
    )
    ap.add_argument('--json-file', required=True,
                    help='path to usc_<term>_courses.json (output of the section scraper)')
    ap.add_argument('--semester',
                    help='USC term code, e.g. 20261. Defaults to the code in the JSON filename; '
                         'if both are present they must agree.')
    ap.add_argument('--prune', action='store_true',
                    help="delete this semester's sections and courses that are not in the JSON "
                         "(cancelled or removed by USC). Use only with a complete catalog: the "
                         "refresh orchestrator passes it after its guards.")
    return ap.parse_args(argv)

def parse_schedule(schedule):
    if not schedule or schedule.strip().upper() == "TBA":
        return None, None, None
    parts = schedule.rsplit(',', 1)
    if len(parts) == 2:
        days = [d.strip() for d in parts[0].split(',')]
        time_str = parts[1].strip()
    else:
        days = []
        time_str = parts[0].strip()
    if time_str and '-' in time_str:
        start, end = [t.strip() for t in time_str.split('-')]
        if ('am' in end or 'pm' in end) and not ('am' in start or 'pm' in start):
            start += ' ' + re.search(r'(am|pm)', end).group(1)
        return days, start, end
    else:
        return days, None, None

def clean_location(location):
    if location:
        return re.sub(r'launch$', '', location).strip()
    return location

def upsert_course(cur, code, title, semester):
    """Insert or update a course and return its ID"""
    cur.execute("""
        INSERT INTO courses (code, title, semester)
        VALUES (%s, %s, %s)
        ON CONFLICT (code, semester) 
        DO UPDATE SET
            title = EXCLUDED.title
        RETURNING id
    """, (code, title, semester))
    return cur.fetchone()[0]

def validate_section_data(section_data):
    """Validate section data before insertion"""
    required_fields = {
        "sectionNumber": str,
        "type": str,
        "units": (str, float)
    }
    
    for field, field_type in required_fields.items():
        value = section_data.get(field)
        if value is None:
            print(f"Missing required field: {field}")
            return False
        if not isinstance(value, field_type):
            print(f"Invalid type for {field}: expected {field_type}, got {type(value)}")
            return False
    return True

def upsert_section(cur, course_id, section_data):
    """Insert or update a section. Returns (id, section_number), or None if it's invalid."""
    if not validate_section_data(section_data):
        print(f"Skipping invalid section: {section_data.get('sectionNumber', 'unknown')}")
        return None

    section_number = section_data.get('sectionNumber')
    
    # Parse units
    units = []
    if 'units' in section_data:
        units_str = section_data['units']
        if isinstance(units_str, str) and '-' in units_str:
            min_unit, max_unit = [float(u.strip()) for u in units_str.split('-')]
            units = [min_unit, max_unit]
        elif isinstance(units_str, str):
            try:
                units = [float(units_str)]
            except Exception:
                units = []

    # Parse schedule and other fields
    schedule = section_data.get('schedule')
    days_of_week, start_time, end_time = parse_schedule(schedule)
    location = clean_location(section_data.get('location'))
    type_ = section_data.get('type')
    d_clearance = section_data.get('d_clearance', False)
    bundle_key = section_data.get('bundle_key')
    
    # Handle instructors
    instructors = section_data.get('instructors', [])
    if instructors is None:
        instructors = []
    
    # Handle registration data
    registered = section_data.get('registered', {})
    num_students_enrolled = registered.get('current')
    num_seats = registered.get('capacity')

    cur.execute("""
        INSERT INTO sections (
            course_id, section_number, units, type, schedule, location, 
            d_clearance, days_of_week, start_time, end_time, instructors,
            num_students_enrolled, num_seats, bundle_key
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (course_id, section_number) 
        DO UPDATE SET
            units = EXCLUDED.units,
            type = EXCLUDED.type,
            schedule = EXCLUDED.schedule,
            location = EXCLUDED.location,
            d_clearance = EXCLUDED.d_clearance,
            days_of_week = EXCLUDED.days_of_week,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            instructors = EXCLUDED.instructors,
            num_students_enrolled = EXCLUDED.num_students_enrolled,
            num_seats = EXCLUDED.num_seats,
            bundle_key = EXCLUDED.bundle_key,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id
    """, (
        course_id, section_number, units, type_, schedule, location,
        d_clearance, days_of_week, start_time, end_time, instructors,
        num_students_enrolled, num_seats, bundle_key
    ))
    
    section_id = cur.fetchone()[0]
    
    # Store section ID for parent-child relationships
    return section_id, section_number

def link_parent_sections(cur, course_id, section_links):
    """Link child sections to their parent sections after all are inserted"""
    for child_section_number, parent_section_number in section_links:
        cur.execute("""
            UPDATE sections SET parent_section_id = (
                SELECT id FROM sections
                WHERE course_id = %s AND section_number = %s
            )
            WHERE course_id = %s AND section_number = %s
        """, (course_id, parent_section_number, course_id, child_section_number))

def clear_parent_links(cur, course_id):
    """Forget a course's parent links so they're re-derived from this load.

    Without this, a lab whose parent changed (or went away) since the last load
    would keep its old parent: link_parent_sections only ever sets links.
    """
    cur.execute("UPDATE sections SET parent_section_id = NULL WHERE course_id = %s", (course_id,))

def prune_course_sections(cur, course_id, keep_section_numbers):
    """Delete a course's sections that aren't in this load. Returns how many.

    Call after clear_parent_links, so no remaining section points at a deleted one.
    """
    cur.execute(
        "DELETE FROM sections WHERE course_id = %s AND NOT (section_number = ANY(%s))",
        (course_id, list(keep_section_numbers)),
    )
    return cur.rowcount

def prune_stale_courses(cur, semester, keep_codes):
    """Delete this semester's courses (and their sections) that aren't in this load.

    Returns (courses deleted, sections deleted). Other semesters are never touched.
    """
    cur.execute(
        "SELECT id FROM courses WHERE semester = %s AND NOT (code = ANY(%s))",
        (semester, list(keep_codes)),
    )
    stale = [row[0] for row in cur.fetchall()]
    if not stale:
        return 0, 0
    cur.execute("UPDATE sections SET parent_section_id = NULL WHERE course_id = ANY(%s)", (stale,))
    cur.execute("DELETE FROM sections WHERE course_id = ANY(%s)", (stale,))
    sections_deleted = cur.rowcount
    cur.execute("DELETE FROM courses WHERE id = ANY(%s)", (stale,))
    return cur.rowcount, sections_deleted

def load_catalog(cur, data, semester, prune=False, log=print):
    """Upsert every course and section in `data` (the scraper's JSON) for one semester.

    Doesn't commit: the caller commits once, so a failure anywhere loads nothing.
    Returns counts for the final report.
    """
    stats = {"courses": 0, "sections": 0, "invalid_sections_skipped": 0, "parent_links": 0,
             "sections_pruned": 0, "courses_pruned": 0, "course_sections_pruned": 0}
    for code, course in data.items():
        title = course.get('title', '')
        course_id = upsert_course(cur, code, title, semester)
        stats["courses"] += 1

        section_links = []  # (child number, parent number)
        loaded_numbers = []
        for section in course.get('sections', []):
            result = upsert_section(cur, course_id, section)
            if result is None:
                stats["invalid_sections_skipped"] += 1
                continue
            _, section_number = result
            loaded_numbers.append(section_number)
            if section.get('parent_section_number'):
                section_links.append((section_number, section.get('parent_section_number')))
        stats["sections"] += len(loaded_numbers)

        clear_parent_links(cur, course_id)
        if prune:
            stats["sections_pruned"] += prune_course_sections(cur, course_id, loaded_numbers)
        if section_links:
            link_parent_sections(cur, course_id, section_links)
        stats["parent_links"] += len(section_links)

        log(f"Processed {code}: {title} with {len(section_links)} linked sections")

    if prune:
        stats["courses_pruned"], stats["course_sections_pruned"] = prune_stale_courses(cur, semester, data.keys())
    return stats

def main(argv=None):
    args = parse_args(argv)
    json_file = args.json_file
    semester = resolve_semester(json_file, args.semester)
    with open(json_file, 'r') as f:
        data = json.load(f)
    if args.prune and not data:
        # An empty catalog with --prune would delete the whole semester.
        raise ValueError(f"{json_file} has no courses; refusing to prune semester {semester}")

    dbname = os.getenv("USC_DB_NAME", "usc_sched")
    user = os.getenv("USC_DB_USER")
    password = os.getenv("USC_DB_PASSWORD")
    host = os.getenv("USC_DB_HOST", "localhost")
    port = int(os.getenv("USC_DB_PORT", "5432"))
    if not user or not password:
        raise RuntimeError("Missing USC_DB_USER/USC_DB_PASSWORD in environment for ingestion script")
    conn = psycopg2.connect(dbname=dbname, user=user, password=password, host=host, port=port)
    cur = conn.cursor()

    print(f"Loading data for semester {semester} from {json_file} into {dbname}@{host}:{port}"
          f"{' (pruning sections/courses not in the file)' if args.prune else ''}...")
    stats = load_catalog(cur, data, semester, prune=args.prune)
    conn.commit()
    print("Data load complete! " + ", ".join(f"{k}={v}" for k, v in stats.items()))
    if stats["invalid_sections_skipped"]:
        print(f"⚠ {stats['invalid_sections_skipped']} invalid section(s) skipped (see 'Skipping invalid section' above)")
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()