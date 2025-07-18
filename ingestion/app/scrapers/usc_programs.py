import argparse, json, time
from pathlib import Path
from typing import Dict, List
from bs4 import BeautifulSoup

# --- Selenium imports ---
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

HEADERS = {"User-Agent": "Mozilla/5.0"}
TIMEOUT = 30

def load_program_urls(json_file: str) -> Dict[str, str]:
    records = json.loads(Path(json_file).read_text())
    return {rec["code"]: rec["href"] for rec in records}

def parse_registered(text: str):
    # e.g. "1 / 15" → {"current": 1, "capacity": 15}
    try:
        current, capacity = [int(x.strip()) for x in text.split("/")[:2]]
        return {"current": current, "capacity": capacity}
    except Exception:
        return {"current": None, "capacity": None}

def fetch_rendered_html(url: str) -> str:
    print(f"\nProcessing URL: {url}")
    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument("--disable-dev-shm-usage")
    
    driver = webdriver.Chrome(options=chrome_options)
    successful_expansions = 0
    
    try:
        driver.get(url)
        
        # More robust initial load waiting with increased timeouts
        try:
            # First wait for page to load completely
            time.sleep(3)  # Add initial wait to ensure page starts loading
            
            # Wait for accordion with increased timeout (25 seconds)
            WebDriverWait(driver, 25).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "mat-accordion.course-accordion"))
            )
            
            # Then wait for panels with increased timeout (10 seconds)
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "mat-expansion-panel"))
            )
            
            # Wait for panels to be fully rendered
            time.sleep(2.5)  # Increased from 1.5s to 2.5s
            
            # Additional check to ensure content is loaded
            WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "mat-expansion-panel-header .item-description"))
            )
            
        except TimeoutException:
            print("Warning: Page didn't load completely")
            return driver.page_source

        # Find and expand all panels
        panel_headers = driver.find_elements(By.CSS_SELECTOR, "mat-expansion-panel-header")
        total_panels = len(panel_headers)
        print(f"Found {total_panels} panels")
        
        # Rest of the function remains the same with optimized timings
        for idx, header in enumerate(panel_headers, 1):
            try:
                title = header.text.split('\n')[0] if header.text else 'Unknown'
                print(f"\rProcessing {idx}/{total_panels}: {title}", end="", flush=True)
                
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", header)
                time.sleep(0.3)
                driver.execute_script("arguments[0].click();", header)
                
                try:
                    WebDriverWait(driver, 3).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, "mat-table.sections-table"))
                    )
                    successful_expansions += 1
                except TimeoutException:
                    continue
                    
                time.sleep(0.2)
                
            except Exception as e:
                print(f"\nError on panel {idx}: {str(e)}")
                continue
                
        print(f"\nExpanded {successful_expansions}/{total_panels} panels")
        return driver.page_source
        
    finally:
        driver.quit()

def extract_courses_from_page(url: str) -> Dict[str, dict]:
    html = fetch_rendered_html(url)
    soup = BeautifulSoup(html, "html.parser")
    result = {}

    accordion = soup.find("mat-accordion", class_="course-accordion")
    if not accordion:
        return result

    panels = accordion.find_all("mat-expansion-panel", class_="course-panel", recursive=False)

    for panel in panels:
        header = panel.find("mat-expansion-panel-header")
        code_title = header.find("div", class_="item-description").get_text(strip=True) if header else ""
        
        if "-" in code_title:
            code, title = map(str.strip, code_title.split("-", 1))
        else:
            code, title = code_title, ""

        # Extract all sections first
        all_sections = []
        mat_table = panel.find("mat-table")
        if mat_table:
            rows = mat_table.find_all("mat-row", recursive=False)
            for row in rows:
                cells = row.find_all("mat-cell", recursive=False)
                if len(cells) < 8:
                    continue
                
                section_cell = cells[0]
                section_number = section_cell.get_text(strip=True)
                d_clearance = bool(section_cell.find("span", class_="d-clearance-icon"))
                units = cells[1].get_text(strip=True)
                type_ = cells[2].get_text(strip=True)
                schedule = cells[3].get_text(strip=True)
                location = cells[4].get_text(strip=True)
                instructors = [i.strip() for i in cells[5].get_text(strip=True).split(",") if i.strip()]
                registered = parse_registered(cells[7].get_text(strip=True))
                
                all_sections.append({
                    "sectionNumber": section_number,
                    "units": units,
                    "type": type_,
                    "schedule": schedule,
                    "location": location,
                    "instructors": instructors,
                    "registered": registered,
                    "d_clearance": d_clearance
                })
        
        # Analyze section pattern to detect bundling
        lecture_positions = []
        for i, section in enumerate(all_sections):
            if section["type"] == "Lecture":
                lecture_positions.append(i)
        
        # If lectures are separated by other section types, it's a bundled course
        is_bundled = False
        if len(lecture_positions) > 1:
            # Check if lectures are not adjacent
            is_bundled = not all(lecture_positions[i+1] - lecture_positions[i] == 1 
                                for i in range(len(lecture_positions)-1))
        
        # Process sections with the appropriate relationships
        processed_sections = []
        current_lecture = None
        bundle_key = None
        current_instructors = []
        
        for section in all_sections:
            if is_bundled:
                if section["type"] == "Lecture":
                    current_lecture = section
                    current_instructors = section.get("instructors", [])
                    # Create a bundle key based on instructors and section number
                    instr_key = "-".join(sorted(current_instructors)) if current_instructors else "unknown"
                    bundle_key = f"{instr_key}_{section['sectionNumber']}"
                    section["bundle_key"] = bundle_key
                    section["parent_section_id"] = None  # Lectures are parents
                else:
                    # This is a child section (discussion/lab)
                    section["bundle_key"] = bundle_key
                    section["parent_section_number"] = current_lecture["sectionNumber"] if current_lecture else None
            
            processed_sections.append(section)
        
        result[code] = {
            "title": title,
            "sections": processed_sections,
            "has_bundled_sections": is_bundled
        }
    
    return result

def crawl(program_urls: Dict[str, str], delay: float=0.75) -> Dict[str, dict]:
    catalogue = {}
    for prog, url in program_urls.items():
        print(f"📑 {prog:<6}", end=" ")
        try:
            items = extract_courses_from_page(url)
            catalogue.update(items)
            print(f"{len(items):>3} classes")
        except Exception as e:
            print("FAILED", e)
        time.sleep(delay)
    return catalogue

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--programs-json", required=True, help="file produced by usc_programs.py")
    ap.add_argument("--delay", type=float, default=0.75, help="seconds between requests")
    ap.add_argument("--term", required=True)
    args = ap.parse_args()

    pages = load_program_urls(args.programs_json)
    print(f"Loaded {len(pages)} program pages")

    data = crawl(pages, args.delay)
    
    # Create scraped_data directory if it doesn't exist
    scraped_data_dir = Path("backend/app/scraped_data")
    scraped_data_dir.mkdir(parents=True, exist_ok=True)
    
    out = scraped_data_dir / f"usc_{args.term}_courses.json"
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"\n✔ Saved → {out.resolve()}")
