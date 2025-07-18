#include "schedule_generator.h"
#include "time_utils.h"
#include <iostream>
#include <algorithm>
#include <thread>
#include <chrono>
#include <set>

// Forward declaration
bool is_valid_schedule(const Schedule& schedule, const std::vector<std::vector<std::string>>& class_spots, DatabaseConnection* db);

ScheduleGenerator::ScheduleGenerator(std::shared_ptr<DatabaseConnection> db)
    : db(db),
      schedule_pool(std::make_unique<std::pmr::synchronized_pool_resource>()),
      item_allocator(schedule_pool.get()) {
}

bool ScheduleGenerator::packages_conflict(
    const std::vector<Section>& pkg1, 
    const std::vector<Section>& pkg2) const {
    // Quick check - if either package is empty, they can't conflict
    if (pkg1.empty() || pkg2.empty()) {
        return false;
    }
    
    // Fast path for day conflicts using standard bit operations (no SIMD needed)
    // First gather all day bits from both packages
    uint8_t days_pkg1 = 0, days_pkg2 = 0;
    
    for (const auto& section : pkg1) days_pkg1 |= section.get_day_bits();
    for (const auto& section : pkg2) days_pkg2 |= section.get_day_bits();
    
    // If there's no overlap in days at all, we can quickly return false
    if ((days_pkg1 & days_pkg2) == 0) {
        return false;  // No shared days, cannot conflict
    }
    
    // Day-by-day optimized check with regular bit operations
    for (const auto& sec1 : pkg1) {
        uint8_t sec1_days = sec1.get_day_bits();
        if (sec1_days == 0) continue; // Skip sections with no days
        
        for (const auto& sec2 : pkg2) {
            uint8_t sec2_days = sec2.get_day_bits();
            if (sec2_days == 0) continue; // Skip sections with no days
            
            // Check day overlap with fast bit operation
            uint8_t day_overlap = sec1_days & sec2_days;
            if (day_overlap == 0) continue; // No overlap on days
            
            // Check if either section has no time info
            if (sec1.get_start_time().empty() || sec1.get_end_time().empty() ||
                sec2.get_start_time().empty() || sec2.get_end_time().empty() ||
                sec1.get_start_time() == "TBA" || sec2.get_start_time() == "TBA") {
                continue;
            }
            
            // Only now check for time overlap - most expensive operation
            if (TimeUtils::times_overlap(
                sec1.get_start_time(), sec1.get_end_time(),
                sec2.get_start_time(), sec2.get_end_time())) {
                return true; // Conflict found!
            }
        }
    }
    
    // No conflicts found
    return false;
}

std::vector<SpotOptions> ScheduleGenerator::prepare_spot_options(
        const std::vector<std::vector<std::string>>& class_spots,
        const UserPreferences& prefs) {

    std::vector<SpotOptions> result;

    std::cout << "Preparing spot options for "
              << class_spots.size() << " spots:\n";
    for (size_t i = 0; i < class_spots.size(); ++i) {
        std::cout << "  Spot " << i << " has "
                  << class_spots[i].size() << " class options:";
        for (const auto& c : class_spots[i]) std::cout << " '" << c << "'";
        std::cout << '\n';
    }

    /* ─────────────────────────────────────────────────────────────────────── */
    for (size_t spot_idx = 0; spot_idx < class_spots.size(); ++spot_idx) {
        SpotOptions spot_options;

        for (const auto& raw_code : class_spots[spot_idx]) {

            std::string code = raw_code;
            code.erase(0,  code.find_first_not_of(" \t\r\n"));
            code.erase(   code.find_last_not_of(" \t\r\n") + 1);

            std::cout << "Looking up sections for class: '" << code << "'\n";
            auto groups = db->find_sections_for_class(code);
            if (groups.empty()) { std::cerr << "  ✖ no sections\n"; continue; }

            /* filter full sections if user asked for it */
            if (prefs.get_exclude_full_sections()) {
                for (auto& g : groups) {
                    g.erase(std::remove_if(g.begin(), g.end(),
                       [](const Section& s){
                           return s.get_num_registered() >= s.get_num_seats();
                       }), g.end());
                }
            }
            if (std::all_of(groups.begin(), groups.end(),
                            [](auto& g){ return g.empty(); })) continue;

            /* ── choose anchor group (prefer anything containing \"Lecture\") */
            int anchor_g = -1;
            for (size_t gi = 0; gi < groups.size(); ++gi)
                if (!groups[gi].empty() &&
                    groups[gi][0].get_section_type().find("Lecture") != std::string::npos) {
                    anchor_g = static_cast<int>(gi); break;
                }
            if (anchor_g == -1) anchor_g = 0;
            if (groups[anchor_g].empty()) continue;           // safeguard

            /* ── build bundles ───────────────────────────────────────────── */
            for (const Section& anchor : groups[anchor_g]) {
                std::vector<std::vector<Section>> lists;
                bool skip_anchor = false;

                for (size_t gi = 0; gi < groups.size(); ++gi) if (gi != (size_t)anchor_g) {
                    std::vector<Section> filtered;
                    for (const Section& s : groups[gi]) {
                        /* professor-lock filter (relaxed) */
                        if (!s.get_parent_section_number().empty() &&
                            !anchor.get_section_number().empty() &&
                            s.get_parent_section_number() != anchor.get_section_number())
                            continue;
                        filtered.push_back(s);
                    }

                    std::cout << "      anchor " << anchor.get_section_number()
                              << "   partner-type " << groups[gi][0].get_section_type()
                              << "   before " << groups[gi].size()
                              << "   after "  << filtered.size() << '\n';

                    if (filtered.empty()) {         // nothing pairs with this anchor
                        std::cout << "      ✖ anchor "
                                  << anchor.get_section_number()
                                  << " discarded – partner list empty\n";
                        skip_anchor = true;
                        break;
                    }
                    lists.push_back(std::move(filtered));
                }
                if (skip_anchor) continue;

                /* iterative cart-product (lists may be empty) */
                if (lists.empty()) {
                    /* class needs only one type → one package per anchor */
                    std::vector<Section> pkg{anchor};
                    spot_options.emplace_back(
                        spot_idx, code,
                        static_cast<int>(spot_options.size()),
                        std::move(pkg));
                } else {
                    std::vector<size_t> idx(lists.size(), 0);
                    bool done = false;
                    while (!done) {
                        std::vector<Section> pkg; pkg.reserve(1 + lists.size());
                        pkg.push_back(anchor);
                        for (size_t k = 0; k < lists.size(); ++k)
                            pkg.push_back(lists[k][idx[k]]);

                        spot_options.emplace_back(
                            spot_idx, code,
                            static_cast<int>(spot_options.size()),
                            std::move(pkg));

                        /* odometer */
                        for (size_t k = 0; ; ++k) {
                            if (k == idx.size()) { done = true; break; }
                            if (++idx[k] < lists[k].size()) break;
                            idx[k] = 0;
                        }
                    }
                }
            } // end anchor loop
        }     // end class loop

        if (!spot_options.empty()) result.push_back(std::move(spot_options));
    }         // end spot loop
    /* ─────────────────────────────────────────────────────────────────────── */

    return result;
}



void ScheduleGenerator::extend_schedules(
    const std::vector<Schedule>& current_schedules,
    const SpotOptions& next_options,
    std::vector<Schedule>& result,
    int spot_idx,
    int limit) {

    size_t n_emitted = 0;
    auto batch_start = std::chrono::high_resolution_clock::now();
    
    // Pre-reserve approximate space in result vector
    size_t estimated_size = std::min(
        static_cast<size_t>(limit),
        current_schedules.size() * next_options.size() / 4
    );
    result.reserve(result.size() + estimated_size);
    
    // Precompute all conflicts - this is our optimization
    auto compatibility_matrix = precompute_compatibility_matrix(current_schedules, next_options, spot_idx);
    
    // Now use the precomputed matrix for schedule building
    for (size_t i = 0; i < current_schedules.size(); i++) {
        // Skip if we've already reached the limit
        if (result.size() >= static_cast<size_t>(limit)) {
            return;
        }
        
        const auto& schedule = current_schedules[i];
        
        for (size_t j = 0; j < next_options.size(); j++) {
            const auto& option = next_options[j];
            
            // Skip if option is for a different spot
            if (option.spot_idx != spot_idx) {
                continue;
            }
            
            // Use precomputed compatibility instead of checking again
            if (compatibility_matrix[i][j]) {
                // No conflict - create new schedule
                Schedule new_schedule = copy_schedule_pooled(schedule);
                new_schedule.push_back(option);
                result.push_back(std::move(new_schedule));
            }
        }
    }
}

std::vector<std::vector<bool>> ScheduleGenerator::precompute_compatibility_matrix(
    const std::vector<Schedule>& schedules,
    const SpotOptions& options,
    int spot_idx) {
    
    // Create matrix: [schedule_idx][option_idx] = true if compatible, false if conflict
    std::vector<std::vector<bool>> compatibility_matrix(schedules.size());
    
    // For each schedule, check compatibility with all options
    for (size_t i = 0; i < schedules.size(); i++) {
        compatibility_matrix[i].resize(options.size(), false);
        
        for (size_t j = 0; j < options.size(); j++) {
            // Skip options for different spots
            if (options[j].spot_idx != spot_idx) {
                continue;
            }
            
            // Check if this option conflicts with this schedule
            bool has_conflict = false;
            const auto& schedule = schedules[i];
            const auto& option = options[j];
            
            // Check for class code duplicates
            for (const auto& existing_item : schedule) {
                if (existing_item.class_code == option.class_code) {
                    has_conflict = true;
                    break;
                }
                
                // Check for time conflicts
                if (packages_conflict(existing_item.sections, option.sections)) {
                    has_conflict = true;
                    break;
                }
            }
            
            // Store result: true if compatible (no conflict), false otherwise
            compatibility_matrix[i][j] = !has_conflict;
        }
    }
    
    return compatibility_matrix;
}

std::vector<Schedule> ScheduleGenerator::generate_all_valid_schedules(
    const std::vector<std::vector<std::string>>& class_spots,
    const UserPreferences& prefs,
    int limit) {
    
    // Add timing code at the start
    auto build_start_time = std::chrono::high_resolution_clock::now();
    
    // Prepare options first
    std::vector<SpotOptions> all_spot_options = prepare_spot_options(class_spots, prefs);

    if (all_spot_options.empty() || all_spot_options[0].empty()) {
        std::cerr << "✖ No valid packages found for the first spot — aborting.\n";
        return {};
    }
    
    // Generate initial schedules (spot 0)
    std::vector<Schedule> current_schedules;
    current_schedules.reserve(std::min(static_cast<size_t>(limit), all_spot_options[0].size()));
    
    for (const auto& option : all_spot_options[0]) {
        // Use memory pool for initial schedules
        Schedule schedule = create_pooled_schedule(all_spot_options.size());
        schedule.push_back(option);
        current_schedules.push_back(std::move(schedule));
        
        // Early stopping if too many options
        if (current_schedules.size() >= static_cast<size_t>(limit)) {
            std::cout << "Warning: Too many options for first spot, limiting to " 
                      << limit << std::endl;
            break;
        }
    }

    
    
    // For later spots, we can parallelize
    for (size_t spot_idx = 1; spot_idx < all_spot_options.size(); ++spot_idx) {
        std::vector<Schedule> next_schedules;
        
        // Determine number of threads based on workload and available cores
        unsigned int thread_count = std::min(
            std::thread::hardware_concurrency(),
            static_cast<unsigned int>(current_schedules.size() / 1000 + 1)
        );
        
        if (thread_count > 1 && current_schedules.size() > 5000) {
            // Parallel processing for large workloads
            std::vector<std::vector<Schedule>> thread_results(thread_count);
            std::vector<std::thread> threads;
            
            size_t chunk_size = current_schedules.size() / thread_count;
            
            for (unsigned int t = 0; t < thread_count; ++t) {
                size_t start = t * chunk_size;
                size_t end = (t == thread_count - 1) ? current_schedules.size() : (t + 1) * chunk_size;
                
                threads.emplace_back([this, &all_spot_options, &current_schedules, 
                                    &thread_results, t, start, end, spot_idx, limit, thread_count]() {
                    std::vector<Schedule> local_results;
                    extend_schedules(
                        std::vector<Schedule>(current_schedules.begin() + start, current_schedules.begin() + end),
                        all_spot_options[spot_idx],
                        local_results,
                        spot_idx,
                        limit / thread_count
                    );
                    thread_results[t] = std::move(local_results);
                });
            }


            
            // Wait for all threads
            for (auto& thread : threads) {
                thread.join();
            }
            
            // Combine results
            for (auto& result : thread_results) {
                next_schedules.insert(next_schedules.end(), 
                                   std::make_move_iterator(result.begin()), 
                                   std::make_move_iterator(result.end()));
                
                if (next_schedules.size() >= static_cast<size_t>(limit)) {
                    next_schedules.resize(limit);
                    break;
                }
            }
        } else {
            // Sequential processing for small workloads
            extend_schedules(current_schedules, all_spot_options[spot_idx], next_schedules, spot_idx, limit);
        }
        
        // Use swap for efficiency
        current_schedules.swap(next_schedules);

        // ── DEBUG: how many schedules after spot_idx
        auto spot_end = std::chrono::high_resolution_clock::now();
        auto spot_ms  = std::chrono::duration_cast<std::chrono::milliseconds>(
                             spot_end - build_start_time
                          ).count();
        std::cout << "[Generator] after spot " << spot_idx
                   << ": " << current_schedules.size()
                   << " schedules built (total build time so far: "                    << spot_ms << "ms)"
                   << std::endl;

        
        // Check limit
        if (current_schedules.size() >= static_cast<size_t>(limit)) {
            current_schedules.resize(limit);
        }
    }
    
    // At the end of the function, right before returning:
    auto build_end_time = std::chrono::high_resolution_clock::now();
    auto build_elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        build_end_time - build_start_time).count();
    std::cout << "Total schedule building time: " << build_elapsed << "ms for " 
              << current_schedules.size() << " schedules" << std::endl;
    
    // Filter schedules to only those that fill all spots and have all required section types
    std::vector<Schedule> valid_schedules;
    for (const auto& sched : current_schedules) {
        if (is_valid_schedule(sched, class_spots, db.get())) {
            valid_schedules.push_back(sched);
            if (valid_schedules.size() >= static_cast<size_t>(limit)) break;
        }
    }
    return valid_schedules;
}

Schedule ScheduleGenerator::create_pooled_schedule(size_t reserve_size) {
    // Create a PMR vector using our memory resource
    Schedule schedule(schedule_pool.get());
    schedule.reserve(reserve_size);
    return schedule;
}

Schedule ScheduleGenerator::copy_schedule_pooled(const Schedule& src) {
    // Create a new schedule in the pool
    Schedule new_schedule(schedule_pool.get());
    new_schedule.reserve(src.size() + 1);
    
    // Copy all items from source schedule
    for (const auto& item : src) {
        new_schedule.push_back(item);
    }
    
    return new_schedule;
}

// Helper: returns true if schedule fills all spots and all required section types for each class
bool is_valid_schedule(const Schedule& schedule, const std::vector<std::vector<std::string>>& class_spots, DatabaseConnection* db) {
    // 1. Each spot must be filled by exactly one class from that spot
    if (schedule.size() != class_spots.size()) return false;
    for (size_t spot_idx = 0; spot_idx < class_spots.size(); ++spot_idx) {
        const auto& item = schedule[spot_idx];
        // Must match a class in this spot
        if (std::find(class_spots[spot_idx].begin(), class_spots[spot_idx].end(), item.class_code) == class_spots[spot_idx].end())
            return false;

        // 2. For each class, must have all required section types
        // You may already have a function for this, but here's a generic version:
        std::set<std::string> required_types = db->get_required_section_types(item.class_code);
        std::set<std::string> present_types;
        for (const auto& section : item.sections) {
            present_types.insert(section.get_section_type());
        }
        for (const auto& req : required_types) {
            if (present_types.count(req) == 0) return false;
        }
    }
    return true;
}