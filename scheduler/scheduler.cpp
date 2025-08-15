#include "scheduler.h"
#include <queue>
#include <functional>
#include <iostream>
#include <algorithm>
#include <iomanip>
#include <thread>
#include <mutex>
#include <future>
#include <atomic>
#include <chrono>
#include <cmath>

// Helper function for clamping values since std::clamp is C++17
template<typename T>
T clamp(const T& value, const T& low, const T& high) {
    return value < low ? low : (value > high ? high : value);
}

Scheduler::Scheduler(std::shared_ptr<DatabaseConnection> db, bool silent_mode) 
    : db_(db), silent_mode_(silent_mode), generator(db), evaluator(db) {
}

std::vector<std::pair<Schedule, double>> Scheduler::build_schedule(
    const std::vector<std::vector<std::string>>& class_spots,
    const UserPreferences& user_prefs,
    int top_n,
    bool silent) {
    if (silent) silent_mode_ = false;
    
    if (!silent_mode_) {
        std::cout << "Generating all valid schedules from " << class_spots.size() << " spots...\n";
    }
    
    // Generate all valid schedules
    auto all_schedules = generator.generate_all_valid_schedules(class_spots, user_prefs);
    
    if (!silent_mode_) {
        std::cout << "Found " << all_schedules.size() << " valid schedules\n";
    }
    
    if (all_schedules.empty()) {
        if (!silent_mode_) {
            std::cout << "No valid schedules found!\n";
        }
        return {};
    }
    
    if (!silent_mode_) {
        std::cout << "Scoring schedules...\n";
    }
    
    // Get the number of available hardware threads (cores)
    unsigned int num_threads = std::thread::hardware_concurrency();
    // Ensure at least 2 threads, but not more than needed
    num_threads = std::max(2u, std::min(num_threads, 
                          static_cast<unsigned int>(all_schedules.size() / 1000 + 1)));
    
    if (!silent_mode_) {
        std::cout << "Using " << num_threads << " threads for parallel schedule evaluation\n";
    }
    
    // Shared data structures need mutex protection
    std::mutex top_schedules_mutex;
    
    // Min heap to store only the top_n schedules
    // We use negative scores to make it a max heap for highest scores
    std::priority_queue<
        std::pair<double, Schedule>,
        std::vector<std::pair<double, Schedule>>,
        std::function<bool(const std::pair<double, Schedule>&, const std::pair<double, Schedule>&)>
    > top_schedules([](const auto& a, const auto& b) {
        return a.first > b.first; // Min heap (keeping lowest scores)
    });
    
    // For time tracking
    std::atomic<int> progress(0);
    auto start_time = std::chrono::high_resolution_clock::now();
    auto last_checkpoint = start_time;
    
    // Worker function that each thread will execute
    auto worker_function = [&](size_t start_idx, size_t end_idx) {
        // Each thread needs a proper database connection with parameters
        auto thread_db = std::make_shared<DatabaseConnection>(
            db_->get_db_name(),     // Add a getter in DatabaseConnection class
            db_->get_user(),        // Add a getter in DatabaseConnection class
            db_->get_password(),    // Add a getter in DatabaseConnection class
            db_->get_host(),        // Add a getter in DatabaseConnection class
            db_->get_port(),        // Add a getter in DatabaseConnection class
            db_->get_semester()     // Add a getter in DatabaseConnection class
        );
        auto thread_evaluator = ScheduleEvaluator(thread_db);
        
        // Each thread gets its own cache to avoid contention
        std::map<std::pair<std::string, std::string>, DatabaseConnection::ProfessorRating> local_cache;
        
        // Process a subset of schedules
        for (size_t i = start_idx; i < end_idx && i < all_schedules.size(); ++i) {
            const auto& schedule = all_schedules[i];
            
            // Evaluate this schedule using thread-local evaluator and cache
            double score = thread_evaluator.evaluate_schedule_with_cache(
                schedule, user_prefs, false, local_cache);
            
            // Thread-safe update of the shared top schedules
            {
                std::lock_guard<std::mutex> lock(top_schedules_mutex);
                if (top_schedules.size() < static_cast<size_t>(top_n)) {
                    top_schedules.emplace(score, schedule);
                } 
                else if (score > top_schedules.top().first) {
                    top_schedules.pop();
                    top_schedules.emplace(score, schedule);
                }
            }
            
            // Update progress counter
            int current_progress = ++progress;
            if (current_progress % 1000 == 0) {
                // Thread-safe output of progress
                std::lock_guard<std::mutex> lock(top_schedules_mutex);
                auto current_time = std::chrono::high_resolution_clock::now();
                auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                    current_time - last_checkpoint).count();
                auto total_elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                    current_time - start_time).count();
                
                if (!silent_mode_) {
                    std::cout << "Processed " << current_progress << "/" << all_schedules.size() 
                            << " schedules (" << (current_progress * 100 / all_schedules.size()) << "%)"
                            << " - Last 1000: " << elapsed << "ms"
                            << " - Avg per schedule: " << (elapsed / 1000.0) << "ms"
                            << " - Total: " << total_elapsed << "ms"
                            << std::endl;
                }
                
                last_checkpoint = current_time;
            }
        }
    };
    
    // Launch threads
    std::vector<std::future<void>> futures;
    size_t chunk_size = (all_schedules.size() + num_threads - 1) / num_threads; // Ceiling division
    
    for (unsigned int i = 0; i < num_threads; ++i) {
        size_t start_idx = i * chunk_size;
        size_t end_idx = std::min((i + 1) * chunk_size, all_schedules.size());
        
        // Launch thread with async and store future for synchronization
        futures.push_back(std::async(std::launch::async, worker_function, start_idx, end_idx));
    }
    
    // Wait for all threads to complete
    for (auto& future : futures) {
        future.wait();
    }
    
    // Final timing
    auto end_time = std::chrono::high_resolution_clock::now();
    auto total_elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(end_time - start_time).count();
    if (!silent_mode_) {
        std::cout << "Total scoring time: " << total_elapsed << "ms for " << all_schedules.size() 
                << " schedules (" << (total_elapsed / (double)all_schedules.size()) << "ms per schedule)" << std::endl;
    }
    
    // Convert top schedules to result vector
    std::vector<Schedule> result;
    result.reserve(top_schedules.size());
    
    // Extract all elements from the heap in ascending score order
    std::vector<std::pair<double, Schedule>> sorted_schedules;
    while (!top_schedules.empty()) {
        sorted_schedules.push_back(top_schedules.top());
        top_schedules.pop();
    }
    
    // Reverse to get descending order (highest scores first)
    std::reverse(sorted_schedules.begin(), sorted_schedules.end());
    
    // Convert to vector of {Schedule, score} pairs
    std::vector<std::pair<Schedule, double>> schedules_with_scores;
    for (const auto& [score, schedule] : sorted_schedules) {
        schedules_with_scores.push_back({schedule, score});
    }
    
    // Apply diversity algorithm to get varied schedules
    if (!silent_mode_) {
        std::cout << "Diversifying schedules to ensure variety...\n";
    }
    
    // First ensure all schedules have all requested classes
    for (const auto& [schedule, score] : schedules_with_scores) {
        if (schedule.size() != class_spots.size()) {
            std::cerr << "Warning: Found incomplete schedule with " << schedule.size() 
                      << " classes but expected " << class_spots.size() << std::endl;
        }
    }
    
    // Verify that diverse_schedules will only return complete schedules
    std::vector<Schedule> diverse_schedules = evaluator.diversify_schedules(schedules_with_scores, top_n);
    
    // Rebuild result with scores
    std::vector<std::pair<Schedule, double>> result_with_scores;
    for (const auto& schedule : diverse_schedules) {
        // Find the original score for this schedule
        double score = 0.0;
        for (const auto& [s, score_val] : schedules_with_scores) {
            bool match = true;
            if (s.size() != schedule.size()) {
                match = false;
            } else {
                for (size_t i = 0; i < s.size(); i++) {
                    if (s[i].class_code != schedule[i].class_code || 
                        s[i].pkg_idx != schedule[i].pkg_idx) {
                        match = false;
                        break;
                    }
                }
            }
            if (match) {
                score = score_val;
                break;
            }
        }
        result_with_scores.push_back({schedule, score});
    }
    
    return result_with_scores;
}

std::map<std::string, double> Scheduler::get_schedule_score_breakdown(
    const Schedule& schedule,
    const UserPreferences& user_prefs) {
    
    return evaluator.get_score_breakdown(schedule, user_prefs);
}

void Scheduler::print_schedule(const Schedule& schedule, bool include_scores) const {
    if (silent_mode_) return; // Don't print anything if in silent mode
    
    std::cout << "\n====== SCHEDULE ======\n";
    
    // Group by class code for cleaner display
    std::map<std::string, std::vector<Section>> classes;
    for (const auto& [spot_idx, class_code, pkg_idx, sections] : schedule) {
        for (const auto& section : sections) {
            classes[class_code].push_back(section);
        }
    }
    
    // Print each class
    for (const auto& [class_code, sections] : classes) {
        std::cout << "\n" << class_code << ":\n";
        
        for (const auto& section : sections) {
            // Format days
            std::string days;
            for (const auto& day : section.get_meeting_days()) {
                days += day + " ";
            }
            
            // Format times
            std::string times;
            if (!section.get_meeting_times().first.empty() && 
                !section.get_meeting_times().second.empty()) {
                times = section.get_meeting_times().first + " - " + 
                        section.get_meeting_times().second;
            } else {
                times = "TBA";
            }
            
            std::cout << "  " << section.get_section_type() 
                      << " (" << section.get_section_number() << "): "
                      << days << " " << times;
                      
            if (!section.get_instructor().empty()) {
                std::cout << " with " << section.get_instructor();
            }
            
            std::cout << "\n";
        }
    }
    
    if (include_scores) {
        // Get the score breakdown and print it
        auto scores = evaluator.get_score_breakdown(schedule);
        
        std::cout << "\nScore Breakdown:\n";
        double total = 0;
        for (const auto& [component, value] : scores) {
            std::cout << "  " << component << ": " << std::fixed 
                      << std::setprecision(2) << value << "\n";
            total += value;
        }
        
        // Calculate normalized score using the same formula as in evaluate_schedule_with_cache
        double normalized = 0;
        
        // DEBUG: Print raw score components for debugging
        std::cout << "\nRAW SCORE COMPONENTS:\n";
        for (const auto& [component, value] : scores) {
            std::cout << "  " << component << ": " << std::fixed 
                      << std::setprecision(2) << value << "\n";
        }
        
        // Apply a massive base boost to all raw scores
        double boosted_total = total + 40.0;
        
        // Maximum-generosity normalization curve
        if (boosted_total >= 60) {  // High scores: 60+ → 8.5-10.0
            normalized = 8.5 + (boosted_total - 60) * 1.5 / 40.0;
            std::cout << "Score bracket: High (60+) → " << normalized << std::endl;
        } else if (boosted_total >= 45) {  // Good scores: 45-60 → 7.5-8.5
            normalized = 7.5 + (boosted_total - 45) * 1.0 / 15.0;
            std::cout << "Score bracket: Good (45-60) → " << normalized << std::endl;
        } else {  // All other scores: 0-45 → 6.0-7.5
            normalized = 6.0 + (boosted_total / 45.0) * 1.5;
            std::cout << "Score bracket: Baseline (0-45) → " << normalized << std::endl;
        }
        normalized = clamp(normalized, 0.0, 10.0);
        
        std::cout << "\nRaw Score: " << std::fixed << std::setprecision(2) << total << "\n";
        std::cout << "Normalized Score (0-10): " << std::fixed << std::setprecision(2) 
                  << normalized << "\n";
    }
    
    std::cout << "=====================\n\n";
}
