import json
import psycopg2
from pathlib import Path
import subprocess

def get_db_conn():
    return psycopg2.connect(
        dbname="usc_sched",
        user="REDACTED",
        password="REDACTED",
        host="localhost"
    )

def get_prof_data(name):
    """Call the Node.js CLI to get RMP data for a professor."""
    try:
        # Add 30 second timeout
        result = subprocess.run(
            [
                "node",
                str(Path(__file__).parent.parent.parent / "rate_my_prof" / "dist" / "prof_lookup_cli.js"),
                name
            ],
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout
        )
    except subprocess.TimeoutExpired:
        print(f"⚠️ Timeout while fetching data for {name}")
        return None
    except Exception as e:
        print(f"⚠️ Error running Node.js script for {name}: {e}")
        return None

    try:
        data = json.loads(result.stdout)
        if not data:
            print(f"No response data for {name}")
            return None
            
        if data.get("found"):
            rmp = data.get("rmp", {})
            if rmp.get("id") and rmp.get("schoolId"):
                # Add reviews even if no summary stats
                if not data.get("summary") and data.get("reviews"):
                    data["summary"] = calculate_summary(data["reviews"])
                return data
            else:
                print(f"Missing required RMP ID fields for {name}")
                return None
        else:
            print(f"Professor not found: {name}")
            return None

    except Exception as e:
        print(f"Error parsing JSON for {name}: {e}")
        print("Full stdout:", result.stdout)
        return None

def aggregate_course_ratings(cur):
    print("Aggregating course-specific professor ratings...")
    cur.execute("""
        INSERT INTO prof_course_ratings (professor_id, course_code, avg_quality, avg_difficulty, num_reviews)
        SELECT
            professor_id,
            course_code,
            AVG(quality_rating) AS avg_quality,
            AVG(difficulty_rating) AS avg_difficulty,
            COUNT(*) AS num_reviews
        FROM reviews
        WHERE course_code IS NOT NULL
        GROUP BY professor_id, course_code
        ON CONFLICT (professor_id, course_code) DO UPDATE
        SET
            avg_quality = EXCLUDED.avg_quality,
            avg_difficulty = EXCLUDED.avg_difficulty,
            num_reviews = EXCLUDED.num_reviews;
    """)
    print("Aggregation complete.")

def calculate_summary(reviews):
    """Calculate summary stats from reviews"""
    if not reviews:
        return {}
        
    quality_ratings = [r.get("qualityRating") for r in reviews if r.get("qualityRating") is not None]
    difficulty_ratings = [r.get("difficultyRating") for r in reviews if r.get("difficultyRating") is not None]
    would_take_again = [r.get("wouldTakeAgain") for r in reviews if r.get("wouldTakeAgain") is not None]
    
    return {
        "avgRating": sum(quality_ratings) / len(quality_ratings) if quality_ratings else None,
        "avgDifficulty": sum(difficulty_ratings) / len(difficulty_ratings) if difficulty_ratings else None,
        "wouldTakeAgainPercent": (sum(1 for x in would_take_again if x == 1) / len(would_take_again) * 100) if would_take_again else None
    }

def update_professor(cur, name, prof_data):
    """Insert or update professor and their reviews"""
    if not prof_data or not prof_data.get("found"):
        return None
        
    rmp = prof_data["rmp"]
    reviews = prof_data.get("reviews", [])
    
    # Calculate summary stats from reviews if not provided
    summary = prof_data.get("summary") or calculate_summary(reviews)

    print(f"\nProcessing {name}:")
    print(f"- RMP ID: {rmp.get('id')}")
    print(f"- School: {rmp.get('schoolName')}")
    print(f"- Reviews: {len(reviews)}")
    print(f"- Avg Rating: {summary.get('avgRating'):.2f}" if summary.get('avgRating') else "- No ratings yet")

    # Insert/Update professor with summary stats
    cur.execute(
        """
        INSERT INTO professors (
            name, rmp_id, rmp_school_id, rmp_school_name,
            avg_rating, avg_difficulty, would_take_again_percent,
            updated_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (name) DO UPDATE SET
            rmp_id = EXCLUDED.rmp_id,
            rmp_school_id = EXCLUDED.rmp_school_id,
            rmp_school_name = EXCLUDED.rmp_school_name,
            avg_rating = COALESCE(EXCLUDED.avg_rating, professors.avg_rating),
            avg_difficulty = COALESCE(EXCLUDED.avg_difficulty, professors.avg_difficulty),
            would_take_again_percent = COALESCE(EXCLUDED.would_take_again_percent, professors.would_take_again_percent),
            updated_at = CURRENT_TIMESTAMP
        RETURNING id
        """,
        (
            name,
            rmp["id"],
            rmp["schoolId"],
            rmp["schoolName"],
            summary.get("avgRating"),
            summary.get("avgDifficulty"),
            summary.get("wouldTakeAgainPercent")
        )
    )
    professor_id = cur.fetchone()[0]
    
    # Process reviews
    review_count = 0
    for review in reviews:
        if all([review.get("date"), review.get("comment")]):
            cur.execute(
                """
                INSERT INTO reviews (
                    professor_id, course_code, quality_rating, 
                    difficulty_rating, review_text, date
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (professor_id, date, review_text) DO NOTHING
                """,
                (
                    professor_id,
                    review.get("class"),
                    review.get("qualityRating"),
                    review.get("difficultyRating"),
                    review.get("comment"),
                    review.get("date")
                )
            )
            review_count += 1
    
    print(f"✅ Added/Updated professor (ID: {professor_id})")
    print(f"✅ Processed {review_count} reviews")
    
    return professor_id

def main():
    # Load all instructors from your courses JSON
    json_file = Path(__file__).parent.parent.parent / "usc_20253_courses.json"
    with open(json_file, "r") as f:
        data = json.load(f)

    # Collect all unique instructor names
    instructors = set()
    for course in data.values():
        for section in course.get("sections", []):
            for instr in section.get("instructors", []):
                if instr and instr.strip():
                    instructors.add(instr.strip())

    print(f"Found {len(instructors)} unique instructors.")

    conn = get_db_conn()
    cur = conn.cursor()
    
    error_count = 0
    success_count = 0

    try:
        for name in sorted(instructors):
            print(f"\nProcessing: {name}")
            
            try:
                # Get RMP data regardless of existing entry
                prof_data = get_prof_data(name)
                if not prof_data:
                    print(f"  ❌ No data found for {name}")
                    error_count += 1
                    continue

                # Update/Insert professor and their reviews
                professor_id = update_professor(cur, name, prof_data)
                if professor_id:
                    print(f"  ✅ Updated/Added professor with id {professor_id}")
                    print(f"    Reviews: {len(prof_data.get('reviews', []))}")
                    success_count += 1
                
                conn.commit()

            except Exception as e:
                print(f"  ⚠️ Error processing {name}: {e}")
                error_count += 1
                conn.rollback()  # Rollback transaction on error
                continue

        # After all reviews are loaded, aggregate course-specific ratings
        print("\nAggregating course ratings...")
        aggregate_course_ratings(cur)
        conn.commit()

    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        conn.rollback()
    finally:
        print(f"\nProcessing complete:")
        print(f"✅ Successfully processed: {success_count}")
        print(f"❌ Errors: {error_count}")
        cur.close()
        conn.close()

if __name__ == "__main__":
    main()