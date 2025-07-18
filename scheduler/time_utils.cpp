// time_utils.cpp
#include "time_utils.h"
#include <sstream>
#include <iomanip>
#include <iostream>
#include <regex>
#include <algorithm>
#include <vector>

double TimeUtils::get_hour_from_time_string(const std::string& time_str) {
    if (time_str.empty() || time_str == "TBA") {
        return -1.0;
    }
    
    // Split the time string at the colon
    std::vector<std::string> parts = split_string(time_str, ':');
    if (parts.size() != 2) {
        return -1.0;
    }
    
    // Get the hour part
    int hour;
    try {
        hour = std::stoi(parts[0]);
    } catch (...) {
        return -1.0;
    }
    
    // Get the minute part and AM/PM indicator
    std::string min_part = parts[1];
    std::vector<std::string> min_ampm = split_string(min_part, ' ');
    if (min_ampm.size() != 2) {
        return -1.0;
    }
    
    int minute;
    try {
        minute = std::stoi(min_ampm[0]);
    } catch (...) {
        return -1.0;
    }
    
    // Convert to 24-hour format
    std::string ampm = min_ampm[1];
    if (ampm == "pm" && hour < 12) {
        hour += 12;
    } else if (ampm == "am" && hour == 12) {
        hour = 0;
    }
    
    // Return as decimal hours
    return hour + minute / 60.0;
}

std::vector<std::string> TimeUtils::split_string(const std::string& str, char delimiter) {
    std::vector<std::string> result;
    std::stringstream ss(str);
    std::string item;
    
    while (std::getline(ss, item, delimiter)) {
        result.push_back(item);
    }
    
    return result;
}

bool TimeUtils::is_empty_or_whitespace(const std::string& str) {
    return str.empty() || std::all_of(str.begin(), str.end(), [](char c) {
        return std::isspace(static_cast<unsigned char>(c));
    });
}

int TimeUtils::get_minutes_between(const std::string& start_time, const std::string& end_time) {
    double start_hour = get_hour_from_time_string(start_time);
    double end_hour = get_hour_from_time_string(end_time);
    
    if (start_hour < 0 || end_hour < 0) {
        return -1;  // Invalid time
    }
    
    // Handle cases where end time is on the next day
    if (end_hour < start_hour) {
        end_hour += 24.0;
    }
    
    return static_cast<int>((end_hour - start_hour) * 60.0);
}

bool TimeUtils::times_overlap(const std::string& start1, const std::string& end1,
                             const std::string& start2, const std::string& end2) {
    double start_hour1 = get_hour_from_time_string(start1);
    double end_hour1 = get_hour_from_time_string(end1);
    double start_hour2 = get_hour_from_time_string(start2);
    double end_hour2 = get_hour_from_time_string(end2);
    
    // Handle invalid times
    if (start_hour1 < 0 || end_hour1 < 0 || start_hour2 < 0 || end_hour2 < 0) {
        return false;
    }
    
    // Handle overnight times
    if (end_hour1 < start_hour1) end_hour1 += 24.0;
    if (end_hour2 < start_hour2) end_hour2 += 24.0;
    
    // Check for overlap
    return (start_hour1 < end_hour2) && (start_hour2 < end_hour1);
}