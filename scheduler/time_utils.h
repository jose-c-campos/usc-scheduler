#pragma once
#include <string>
#include <vector>

class TimeUtils {
public:
    // Convert a time string (e.g., "2:00 pm") to hour (e.g., 14.0)
    static double get_hour_from_time_string(const std::string& time_str);
    
    // Get minutes between two time strings
    static int get_minutes_between(const std::string& start_time, const std::string& end_time);
    
    // Check if two time ranges overlap
    static bool times_overlap(const std::string& start1, const std::string& end1,
                             const std::string& start2, const std::string& end2);
    
private:
    // Helper functions
    static std::vector<std::string> split_string(const std::string& str, char delimiter);
    static bool is_empty_or_whitespace(const std::string& str);
};
