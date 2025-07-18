#pragma once
#include "database.h"
#include "schedule_generator.h"
#include "schedule_evaluator.h"
#include "user_preferences.h"
#include <vector>
#include <string>
#include <map>
#include <memory>

// Schedule is now defined in schedule_generator.h
// using Schedule = std::vector<ScheduleItem>;

class Scheduler {
public:
    Scheduler(std::shared_ptr<DatabaseConnection> db, bool silent_mode = false);
    
    // Main entry point - build optimal schedules
    std::vector<std::pair<Schedule, double>> build_schedule(
        const std::vector<std::vector<std::string>>& class_spots,
        const UserPreferences& user_prefs = UserPreferences(),
        int top_n = 10,
        bool silent = false); // Add this parameter
    
    // Get detailed scoring breakdown for a schedule
    std::map<std::string, double> get_schedule_score_breakdown(
        const Schedule& schedule,
        const UserPreferences& user_prefs = UserPreferences());
    
    // Print a schedule in human-readable format
    void print_schedule(const Schedule& schedule, bool include_scores = false) const;

private:
    std::shared_ptr<DatabaseConnection> db_;
    bool silent_mode_; // Add this flag
    ScheduleGenerator generator;
    ScheduleEvaluator evaluator;
};