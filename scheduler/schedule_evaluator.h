#pragma once
#include "database.h"
#include "user_preferences.h"
#include "section.h"
#include "schedule_generator.h"
#include <vector>
#include <string>
#include <map>
#include <memory>
#include <set>

class ScheduleEvaluator {
public:
    explicit ScheduleEvaluator(std::shared_ptr<DatabaseConnection> db);

    /* plain (no cache) */
    double evaluate_schedule(const Schedule& sched,
                             const UserPreferences& prefs = {},
                             bool verbose = false);

    /* with a shared (thread‑local) professor‑rating cache */
    double evaluate_schedule_with_cache(
        const Schedule& sched,
        const UserPreferences& prefs,
        bool verbose,
        std::map<std::pair<std::string,std::string>,
                 DatabaseConnection::ProfessorRating>& cache);

    /* convenience – creates its own cache */
    double evaluate_schedule_with_cache(const Schedule& sched,
                                        const UserPreferences& prefs = {},
                                        bool verbose = false);

    std::map<std::string,double> get_score_breakdown(
        const Schedule& sched,
        const UserPreferences& prefs = {}) const;
        
    /* schedule diversity function */
    std::vector<Schedule> diversify_schedules(
        const std::vector<std::pair<Schedule, double>>& scored_schedules, 
        int count_to_return) const;

    /* helpers exposed for diagnostics */
    std::set<std::string> get_schedule_days_used(const Schedule& sched) const;
    std::pair<double,double> get_schedule_time_range(const Schedule& sched) const;
    void print_score_breakdown(const std::map<std::string,double>& parts,
                               const Schedule& sched) const;

private:
    std::shared_ptr<DatabaseConnection> db;

    /* internal helpers */
    std::tuple<double,double,double> get_section_time_info(const Section& s) const;
    double professor_bundle(const Schedule& s,
                            std::map<std::pair<std::string,std::string>,
                                     DatabaseConnection::ProfessorRating>* cache) const;
    double day_bundle(const Schedule& s,const UserPreferences& p) const;
    double time_bundle(const Schedule& s,const UserPreferences& p) const;
    double misc_bundle(const Schedule& s,const UserPreferences& p) const;
};
