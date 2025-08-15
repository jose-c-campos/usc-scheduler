#include "schedule_evaluator.h"
#include "time_utils.h"
#include <algorithm>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <cmath>

// Helper function for clamping values since std::clamp is C++17
template<typename T>
T clamp(const T& value, const T& low, const T& high) {
    return value < low ? low : (value > high ? high : value);
}

/* ───────────────────────── ctor ───────────────────────── */
ScheduleEvaluator::ScheduleEvaluator(std::shared_ptr<DatabaseConnection> db)
: db(std::move(db)) {}

/* ───────────────── section‑level helpers ──────────────── */
std::tuple<double,double,double>
ScheduleEvaluator::get_section_time_info(const Section& sec) const {
    const auto& st = sec.get_start_time();
    const auto& et = sec.get_end_time();
    if (st.empty() || et.empty() || st=="TBA" || et=="TBA") return {-1,-1,-1};
    double sh = TimeUtils::get_hour_from_time_string(st);
    double eh = TimeUtils::get_hour_from_time_string(et);
    double dur = eh - sh;
    if (dur < 0) dur += 24.0;        // overnight
    return {sh,eh,dur};
}

/* ───────────────── schedule‑wide helpers ──────────────── */
std::set<std::string>
ScheduleEvaluator::get_schedule_days_used(const Schedule& sched) const {
    uint8_t bits = 0;
    for (const auto& item : sched)
        for (const auto& s : item.sections) bits |= s.get_day_bits();

    static const std::vector<std::pair<uint8_t,const char*>> map {
        {1,"Mon"},{2,"Tue"},{4,"Wed"},{8,"Thu"},{16,"Fri"}
    };
    std::set<std::string> out;
    for (auto [b,d] : map) if (bits & b) out.insert(d);
    return out;
}

std::pair<double,double>
ScheduleEvaluator::get_schedule_time_range(const Schedule& sched) const {
    double earliest = 24.0, latest = 0.0;
    bool any = false;
    for (const auto& it : sched)
        for (const auto& s : it.sections) {
            auto [sh,eh,du] = get_section_time_info(s);
            if (sh<0) continue;
            earliest = std::min(earliest,sh);
            latest   = std::max(latest,eh);
            any = true;
        }
    return any ? std::make_pair(earliest,latest) : std::make_pair(-1.0,-1.0);
}

/* ─────────────────────── bundles ──────────────────────── */
double ScheduleEvaluator::professor_bundle(
        const Schedule& sched,
        std::map<std::pair<std::string,std::string>,
                 DatabaseConnection::ProfessorRating>* cache) const {

    auto pull_rating = [&](const std::string& prof,const std::string& code){
        std::pair<std::string,std::string> key{prof,code};
        if (cache) {
            auto it = cache->find(key);
            if (it!=cache->end()) return it->second;
        }
        auto r = db->get_professor_ratings(prof,code);
        if (cache) (*cache)[key] = r;
        return r;
    };

    double sum_overall=0, sum_course=0, sum_wta=0, sum_diff=0;
    int cnt = 0;

    for (const auto& it : sched)
        for (const auto& s : it.sections) {
            std::string prof = s.get_instructor();
            if (prof.empty() || prof=="{}" || prof=="TBA") continue;
            prof.erase(std::remove_if(prof.begin(),prof.end(),
                                      [](char c){return c=='{'||c=='}'||c=='\"';}),prof.end());

            auto r = pull_rating(prof,it.class_code);
            if (r.quality<=0 && r.course_specific_quality<=0) continue;

            sum_overall += r.quality;
            sum_course  += (r.course_specific_quality>0 ? r.course_specific_quality
                                                        : r.quality);   // fallback
            sum_wta     += r.would_take_again/20.0;       // 0‑5
            sum_diff    += r.difficulty;
            ++cnt;
        }

    if (cnt==0) return 0;

    double avg_overall = sum_overall/cnt;
    double avg_course  = sum_course /cnt;
    double avg_wta     = sum_wta    /cnt;
    double avg_diff    = sum_diff   /cnt;

    /* difficulty is better when low – invert */
    double inv_diff = 5.0 - clamp(avg_diff,0.0,5.0);

    /* bundle weight = 40 → multiply by 2 to stretch 0‑20 → 0‑40 */
    double raw20 = avg_overall + avg_course + avg_wta + inv_diff; // 0‑20
    return raw20 * 2.0;                                           // 0‑40
}

double ScheduleEvaluator::day_bundle(const Schedule& sched,
                                     const UserPreferences& prefs) const {
    if (prefs.get_days_off().empty()) return 0;      // no preference

    std::set<std::string> used = get_schedule_days_used(sched);
    std::set<std::string> unwanted(prefs.get_days_off().begin(),
                                   prefs.get_days_off().end());

    /* max 20 pts, lose 5 for every “bad” day that contains class */
    double score = 20.0;
    for (const auto& d : unwanted)
        if (used.count(d)) score -= 5.0;
    return std::max(0.0,score);
}

double ScheduleEvaluator::time_bundle(const Schedule& sched,
                                      const UserPreferences& prefs) const {
    int pref = prefs.get_time_of_day_preference();   // -1 morn, 0 none, 1 aft, 2 eve
    if (pref==0) return 0;                           // no preference

    auto [earliest,latest] = get_schedule_time_range(sched);
    if (earliest<0) return 0;

    auto in_zone = [&](double h){
        switch(pref){
            case -1: return h>=8  && h<11.5;
            case  1: return h>=11.5 && h<16;
            case  2: return h>=16 && h<=21;
        }
        return false;
    };

    /* start at 20, subtract 5 for each section whose *start* is outside the zone */
    double score = 20.0;
    for (const auto& it : sched)
        for (const auto& s : it.sections) {
            auto [sh,eh,du] = get_section_time_info(s);
            if (sh<0) continue;
            if (!in_zone(sh)) score -= 5.0;
        }
    return std::max(0.0,score);
}

double ScheduleEvaluator::misc_bundle(const Schedule& sched,
                                      const UserPreferences& prefs) const {
    /* 10 pts lecture‑length, 10 pts lab/disc */
    double score = 0;

    /* lecture length */
    if (prefs.get_lecture_length_preference()!=0){
        std::vector<double> durations;
        for (const auto& it : sched)
            for (const auto& s : it.sections)
                if (s.get_section_type()=="Lecture"){
                    auto [sh,eh,du] = get_section_time_info(s);
                    if (du>0) durations.push_back(du);
                }
        if (!durations.empty()){
            double avg = std::accumulate(durations.begin(),durations.end(),0.0)
                         / durations.size();
            if (prefs.get_lecture_length_preference()<0){     // short‑n‑freq
                /* map 0‑1.5h → 10 pts, 1.5‑3h → 0 pts */
                score += clamp(1.5 - avg,0.0,1.5) /1.5 * 10.0;
            } else {                                          // long‑n‑rare
                /* 3h+ = 10, 1.5h = 0 */
                score += clamp(avg - 1.5,0.0,1.5) /1.5 * 10.0;
            }
        }
    }

    /* lab / discussion avoidance */
    int bad = 0;
    if (prefs.get_avoid_labs() || prefs.get_avoid_discussions()){
        for (const auto& it : sched)
            for (const auto& s : it.sections){
                std::string t = s.get_section_type();
                bool is_lab = t=="Lab";
                bool is_disc = t=="Discussion" || t=="Quiz";
                if ((is_lab && prefs.get_avoid_labs()) ||
                    (is_disc&& prefs.get_avoid_discussions()))
                    ++bad;
            }
        score += std::max(0, 2 - bad) * 5.0; // 0,5,10
    }

    return score;
}

/* ───────────────────── evaluation ─────────────────────── */
double ScheduleEvaluator::evaluate_schedule_with_cache(
    const Schedule& sched,const UserPreferences& prefs,bool verbose,
    std::map<std::pair<std::string,std::string>,
             DatabaseConnection::ProfessorRating>& cache) {

    if (sched.empty()) return -999;

    std::map<std::string,double> parts;
    parts["professor"] = professor_bundle(sched,&cache);
    parts["days"]      = day_bundle(sched,prefs);
    parts["times"]     = time_bundle(sched,prefs);
    parts["misc"]      = misc_bundle(sched,prefs);

    double raw = 0;
    for (auto& [k,v] : parts) raw += v;
    
    // Apply a massive base boost to all raw scores to prevent very low scores
    // The +40 baseline ensures even zero-scored schedules get a respectable score
    double boosted_raw = raw + 40.0;
    
    // DEBUG: Print raw score components
    std::cout << "Schedule evaluation - Raw score: " << raw 
              << " | Boosted: " << boosted_raw << std::endl;

    // Maximum-generosity normalization curve - essentially a very flat curve
    // that keeps all scores between 6.0 and 10.0
    double normalized = 0;
    if (boosted_raw >= 60) {  // High scores: 60+ → 8.5-10.0
        normalized = 8.5 + (boosted_raw - 60) * 1.5 / 40.0;
        std::cout << "Score bracket: High (60+) → " << normalized << std::endl;
    } else if (boosted_raw >= 45) {  // Good scores: 45-60 → 7.5-8.5
        normalized = 7.5 + (boosted_raw - 45) * 1.0 / 15.0;
        std::cout << "Score bracket: Good (45-60) → " << normalized << std::endl;
    } else {  // All other scores: 0-45 → 6.0-7.5
        normalized = 6.0 + (boosted_raw / 45.0) * 1.5;
        std::cout << "Score bracket: Baseline (0-45) → " << normalized << std::endl;
    }
    
    // Ensure we stay in the 0-10 range
    normalized = clamp(normalized, 0.0, 10.0);

    // DEBUGGING: Always print score details for low scores
    if (verbose || normalized < 6.0){
        print_score_breakdown(parts,sched);
        std::cout << "TOTAL (0‑100 raw): " << raw << '\n';
        std::cout << "RAW BREAKDOWN: professor=" << parts["professor"] 
                  << ", days=" << parts["days"] 
                  << ", times=" << parts["times"] 
                  << ", misc=" << parts["misc"] << '\n';
        std::cout << "NORMALIZED (0-10): " << normalized << '\n';
        std::cout << "-------------------------------------" << '\n';
    }
    
    return normalized; // Return normalized score instead of raw
}

/* thin wrappers */
double ScheduleEvaluator::evaluate_schedule(const Schedule& s,
                                            const UserPreferences& p,bool v){
    static thread_local std::map<std::pair<std::string,std::string>,
                                 DatabaseConnection::ProfessorRating> dummy;
    return evaluate_schedule_with_cache(s,p,v,dummy);
}
double ScheduleEvaluator::evaluate_schedule_with_cache(const Schedule& s,
              const UserPreferences& p,bool v){
    static thread_local std::map<std::pair<std::string,std::string>,
                                 DatabaseConnection::ProfessorRating> local;
    return evaluate_schedule_with_cache(s,p,v,local);
}

/* ─────────── breakdown helpers (for UI / debug) ───────── */
std::map<std::string,double>
ScheduleEvaluator::get_score_breakdown(const Schedule& s,
                                       const UserPreferences& p) const {
    std::map<std::string,double> parts;
    parts["professor"] = professor_bundle(s,nullptr);
    parts["days"]      = day_bundle(s,p);
    parts["times"]     = time_bundle(s,p);
    parts["misc"]      = misc_bundle(s,p);
    return parts;
}

/* ─────────── schedule diversity algorithm ───────────── */
std::vector<Schedule> ScheduleEvaluator::diversify_schedules(
        const std::vector<std::pair<Schedule, double>>& scored_schedules, 
        int count_to_return) const {
    
    if (scored_schedules.size() <= count_to_return) {
        std::vector<Schedule> result;
        for (const auto& pair : scored_schedules) {
            result.push_back(pair.first);
        }
        return result;
    }
    
    // First verify all schedules have the same number of spots
    // This ensures we only consider complete schedules
    size_t required_size = 0;
    for (const auto& [schedule, _] : scored_schedules) {
        if (required_size == 0) {
            required_size = schedule.size();
        } else if (schedule.size() != required_size) {
            std::cerr << "Warning: Found schedule with incorrect size: " 
                      << schedule.size() << " vs required " << required_size << std::endl;
        }
    }
    
    // Filter to only include complete schedules
    std::vector<std::pair<Schedule, double>> complete_schedules;
    for (const auto& pair : scored_schedules) {
        if (pair.first.size() == required_size) {
            complete_schedules.push_back(pair);
        }
    }
    
    if (complete_schedules.empty()) {
        std::cerr << "Error: No complete schedules found after filtering!" << std::endl;
        // Return whatever we have if nothing passes the filter
        std::vector<Schedule> fallback;
        size_t count = scored_schedules.size() < static_cast<size_t>(count_to_return) ? 
                      scored_schedules.size() : static_cast<size_t>(count_to_return);
        for (size_t i = 0; i < count; i++) {
            fallback.push_back(scored_schedules[i].first);
        }
        return fallback;
    }
    
    // Sort by score
    std::vector<std::pair<Schedule, double>> sorted_schedules = complete_schedules;
    std::sort(sorted_schedules.begin(), sorted_schedules.end(), 
        [](const auto& a, const auto& b) {
            return a.second > b.second; // Highest score first
        });
    
    // DEBUG: Print top schedule scores
    std::cout << "\n--- TOP SCHEDULE SCORES ---" << std::endl;
    int count = std::min(10, static_cast<int>(sorted_schedules.size()));
    for (int i = 0; i < count; i++) {
        std::cout << "Schedule #" << (i+1) << " score: " << sorted_schedules[i].second << std::endl;
    }
    std::cout << "-------------------------\n" << std::endl;
    
    std::vector<Schedule> diverse_schedules;
    diverse_schedules.push_back(sorted_schedules[0].first); // Always include top schedule
    
    // Calculate similarity between schedules
    auto calculate_similarity = [](const Schedule& a, const Schedule& b) -> float {
        float similarity = 0.0f;
        int matching_sections = 0;
        int total_sections = 0;
        
        // For each class in first schedule, find matching class in second schedule
        for (const auto& item_a : a) {
            for (const auto& item_b : b) {
                if (item_a.class_code == item_b.class_code) {
                    // Count matching sections
                    for (const auto& sec_a : item_a.sections) {
                        for (const auto& sec_b : item_b.sections) {
                            if (sec_a.get_section_number() == sec_b.get_section_number()) {
                                matching_sections++;
                            }
                        }
                        total_sections++;
                    }
                }
            }
        }
        
        return total_sections > 0 ? static_cast<float>(matching_sections) / total_sections : 0.0f;
    };
    
    // Track professors seen in schedules
    std::map<std::string, int> professor_frequency;
    for (const auto& schedule : diverse_schedules) {
        for (const auto& item : schedule) {
            for (const auto& section : item.sections) {
                std::string prof = section.get_instructor();
                if (!prof.empty() && prof != "TBA" && prof != "{}") {
                    prof.erase(std::remove_if(prof.begin(), prof.end(),
                        [](char c){return c=='{'||c=='}'||c=='\"';}), prof.end());
                    professor_frequency[prof]++;
                }
            }
        }
    }
    
    // Greedy algorithm to select diverse schedules
    while (diverse_schedules.size() < count_to_return && 
           diverse_schedules.size() < sorted_schedules.size()) {
        
        float best_distance = -1.0f;
        int best_idx = -1;
        
        // Find schedule with maximum minimum distance to already selected schedules
        for (size_t i = 0; i < sorted_schedules.size(); i++) {
            const auto& candidate = sorted_schedules[i].first;
            
            // Skip if this schedule is already selected
            bool already_selected = false;
            for (const auto& sel : diverse_schedules) {
                // Compare schedules by their memory addresses
                if (std::addressof(sel) == std::addressof(candidate)) {
                    already_selected = true;
                    break;
                }
            }
            
            // Check more thoroughly if needed
            if (!already_selected) {
                for (const auto& sel : diverse_schedules) {
                    if (sel.size() == candidate.size()) {
                        bool identical = true;
                        for (size_t j = 0; j < sel.size(); j++) {
                            if (sel[j].class_code != candidate[j].class_code ||
                                sel[j].pkg_idx != candidate[j].pkg_idx) {
                                identical = false;
                                break;
                            }
                        }
                        if (identical) {
                            already_selected = true;
                            break;
                        }
                    }
                }
            }
            
            if (already_selected) continue;
            
            // Find minimum distance to any selected schedule
            float min_distance = std::numeric_limits<float>::max();
            for (const auto& sel : diverse_schedules) {
                float similarity = calculate_similarity(sel, candidate);
                float distance = 1.0f - similarity;
                min_distance = std::min(min_distance, distance);
            }
            
            // Calculate professor diversity bonus
            float professor_diversity_bonus = 0.0f;
            for (const auto& item : candidate) {
                for (const auto& section : item.sections) {
                    std::string prof = section.get_instructor();
                    if (!prof.empty() && prof != "TBA" && prof != "{}") {
                        prof.erase(std::remove_if(prof.begin(), prof.end(),
                            [](char c){return c=='{'||c=='}'||c=='\"';}), prof.end());
                        
                        // Lower frequency means more diversity bonus
                        if (professor_frequency.count(prof) > 0) {
                            professor_diversity_bonus += 0.1f / (professor_frequency[prof] + 1);
                        } else {
                            professor_diversity_bonus += 0.1f;
                        }
                    }
                }
            }
            
            // Adjust distance with professor diversity bonus
            min_distance += professor_diversity_bonus;
            
            // If this schedule has better minimum distance
            if (min_distance > best_distance) {
                best_distance = min_distance;
                best_idx = i;
            }
        }
        
        if (best_idx >= 0) {
            diverse_schedules.push_back(sorted_schedules[best_idx].first);
            
            // Update professor frequency for the newly added schedule
            for (const auto& item : sorted_schedules[best_idx].first) {
                for (const auto& section : item.sections) {
                    std::string prof = section.get_instructor();
                    if (!prof.empty() && prof != "TBA" && prof != "{}") {
                        prof.erase(std::remove_if(prof.begin(), prof.end(),
                            [](char c){return c=='{'||c=='}'||c=='\"';}), prof.end());
                        professor_frequency[prof]++;
                    }
                }
            }
        } else {
            break; // No more diverse schedules found
        }
    }
    
    return diverse_schedules;
}

void ScheduleEvaluator::print_score_breakdown(
        const std::map<std::string,double>& parts,
        const Schedule& sched) const {
    std::cout << "\n── Score breakdown ──\n";
    for (auto& [k,v] : parts)
        std::cout << std::setw(12) << k << ": " << std::fixed
                  << std::setprecision(2) << v << '\n';
    auto [st,et] = get_schedule_time_range(sched);
    std::cout << "time span  : " << (st<0?"n/a":std::to_string(st))
              << " - "           << (et<0?"n/a":std::to_string(et))
              << "\n───────────────\n";
}
