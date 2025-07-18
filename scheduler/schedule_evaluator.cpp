#include "schedule_evaluator.h"
#include "time_utils.h"
#include <algorithm>
#include <iomanip>
#include <iostream>
#include <numeric>

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
    double inv_diff = 5.0 - std::clamp(avg_diff,0.0,5.0);

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
                score += std::clamp(1.5 - avg,0.0,1.5) /1.5 * 10.0;
            } else {                                          // long‑n‑rare
                /* 3h+ = 10, 1.5h = 0 */
                score += std::clamp(avg - 1.5,0.0,1.5) /1.5 * 10.0;
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

    if (verbose){
        print_score_breakdown(parts,sched);
        std::cout << "TOTAL (0‑100 raw): " << raw << '\n';
    }
    return raw;
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
