#pragma once
#include "database.h"
#include "section.h"
#include "user_preferences.h"
#include <vector>
#include <string>
#include <memory>
#include <memory_resource> // For PMR containers

// Define our new struct to replace the tuple
struct ScheduleItem {
    int spot_idx;
    std::string class_code;
    int pkg_idx;
    std::vector<Section> sections;
    
    // Default constructor
    ScheduleItem() : spot_idx(0), pkg_idx(0) {}
    
    // Full constructor
    ScheduleItem(int spot, std::string code, int pkg, std::vector<Section> secs)
        : spot_idx(spot), class_code(std::move(code)), pkg_idx(pkg), sections(std::move(secs)) {}
};

// Use PMR vector for memory pooling
using Schedule = std::pmr::vector<ScheduleItem>;
using SpotOptions = std::vector<ScheduleItem>; // Keep this as standard vector

class ScheduleGenerator {
private:
    std::shared_ptr<DatabaseConnection> db;
    
    // Memory pool for schedules
    std::unique_ptr<std::pmr::synchronized_pool_resource> schedule_pool;
    std::pmr::polymorphic_allocator<ScheduleItem> item_allocator;
    
    // Helper methods
    bool packages_conflict(const std::vector<Section>& pkg1, 
                          const std::vector<Section>& pkg2) const;
    
    std::vector<SpotOptions> prepare_spot_options(
        const std::vector<std::vector<std::string>>& class_spots,
        const UserPreferences& prefs = UserPreferences());
    
    void extend_schedules(const std::vector<Schedule>& current_schedules,
                         const SpotOptions& next_options,
                         std::vector<Schedule>& result,
                         int spot_idx,
                         int limit);
                         
    // Memory pooled schedule creation methods
    Schedule create_pooled_schedule(size_t reserve_size);
    Schedule copy_schedule_pooled(const Schedule& src);

    // Precompute compatibility between schedules and options
    std::vector<std::vector<bool>> precompute_compatibility_matrix(
        const std::vector<Schedule>& schedules,
        const SpotOptions& options,
        int spot_idx);

public:
    ScheduleGenerator(std::shared_ptr<DatabaseConnection> db);
    
    // Generate all valid schedules from the class spots
    std::vector<Schedule> generate_all_valid_schedules(
        const std::vector<std::vector<std::string>>& class_spots,
        const UserPreferences& prefs = UserPreferences(),
        int limit = 10000000);
};