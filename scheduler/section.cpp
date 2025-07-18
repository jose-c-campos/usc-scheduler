// section.cpp
#include "section.h"
#include "time_utils.h"
#include <sstream>
#include <algorithm>
#include <set>

Section::Section(std::string sectionType, 
                 std::vector<std::string> meeting_days,
                 std::pair<std::string, std::string> meeting_times,
                 std::string location, 
                 int num_registered, 
                 int num_seats,
                 std::string instructor,
                 std::string section_number,
                 std::string parent_section_number)
    : sectionType(sectionType),
      meeting_days(meeting_days),
      meeting_times(meeting_times),
      location(location),
      num_registered(num_registered),
      num_seats(num_seats),
      instructor(instructor),
      section_number(section_number),
      parent_section_number(parent_section_number) {
    
    // Process the meeting days
    for (const auto& day_string : meeting_days) {
        // Check if this is a comma-separated list of days
        std::string day = day_string;
        
        // Remove any curly braces
        day.erase(std::remove(day.begin(), day.end(), '{'), day.end());
        day.erase(std::remove(day.begin(), day.end(), '}'), day.end());
        
        // If there are commas, split into individual days
        size_t pos = 0;
        std::string token;
        std::string delimiter = ",";
        
        if (day.find(delimiter) != std::string::npos) {
            // String contains commas, split it
            while ((pos = day.find(delimiter)) != std::string::npos) {
                token = day.substr(0, pos);
                /* --- trim token --- */
                token.erase(0, token.find_first_not_of(" \t\r\n"));
                token.erase(token.find_last_not_of(" \t\r\n") + 1);

                if (!token.empty()) {
                    this->meeting_days.push_back(token);
                }
                day.erase(0, pos + delimiter.length());
            }
            // Add the last part
            if (!day.empty()) {
                this->meeting_days.push_back(day);
            }
        } else {
            // No commas, add as is
            if (!day.empty()) {
                this->meeting_days.push_back(day);
            }
        }
    }
}

bool Section::conflicts_with(const Section& other) const {
    // If either section has no meeting times, they don't conflict
    if (meeting_times.first.empty() || meeting_times.second.empty() ||
        other.meeting_times.first.empty() || other.meeting_times.second.empty()) {
        return false;
    }
    
    // Check if they share any days
    std::set<std::string> my_days(meeting_days.begin(), meeting_days.end());
    std::set<std::string> other_days(other.meeting_days.begin(), other.meeting_days.end());
    
    bool have_common_days = false;
    for (const auto& day : my_days) {
        if (other_days.find(day) != other_days.end()) {
            have_common_days = true;
            break;
        }
    }
    
    if (!have_common_days) {
        return false;
    }
    
    // Use TimeUtils for time conversion
    double start1 = TimeUtils::get_hour_from_time_string(meeting_times.first);
    double end1 = TimeUtils::get_hour_from_time_string(meeting_times.second);
    double start2 = TimeUtils::get_hour_from_time_string(other.meeting_times.first);
    double end2 = TimeUtils::get_hour_from_time_string(other.meeting_times.second);
    
    // Check for invalid time formats
    if (start1 < 0 || end1 < 0 || start2 < 0 || end2 < 0) {
        return false;
    }
    
    // Compare times (no conflict if one ends before the other starts)
    return !(end1 <= start2 || end2 <= start1);
}

std::string Section::to_string() const {
    std::stringstream ss;
    ss << "Section(" << section_number << ": ";
    
    // Format meeting days
    for (const auto& day : meeting_days) {
        ss << day;
    }
    
    // Format meeting times
    ss << " " << meeting_times.first << "-" << meeting_times.second;
    
    // Add instructor if available
    if (!instructor.empty()) {
        ss << ", " << instructor;
    } else {
        ss << ", None";
    }
    
    ss << ")";
    return ss.str();
}

// Add the missing time getters
std::string Section::get_start_time() const {
    return meeting_times.first;
}

std::string Section::get_end_time() const {
    return meeting_times.second;
}

// Add parent section number getter
std::string Section::get_parent_section_number() const {
    return parent_section_number;
}

// Implement other getters that might be missing
std::string Section::get_section_type() const {
    return sectionType;
}

const std::vector<std::string>& Section::get_meeting_days() const {
    return meeting_days;
}

const std::pair<std::string, std::string>& Section::get_meeting_times() const {
    return meeting_times;
}

std::string Section::get_location() const {
    return location;
}

int Section::get_num_registered() const {
    return num_registered;
}

int Section::get_num_seats() const {
    return num_seats;
}

std::string Section::get_instructor() const {
    return instructor;
}

std::string Section::get_section_number() const {
    return section_number;
}

// Assuming you have a day bits implementation
uint8_t Section::get_day_bits() const {
    // This is a placeholder - make sure your actual implementation is here
    uint8_t bits = 0;
    for (const auto& day : meeting_days) {
        // Monday
        if (day == "Mon"      || day == " Mon"     || day == "Mon "   ||
            day == "Monday"   || day == " Monday"  || day == "Monday ")
            bits |= 0x01;

        // Tuesday
        if (day == "Tue"      || day == " Tue"     || day == "Tue "   ||
            day == "Tues"     || day == " Tues"    || day == "Tues "  ||
            day == "Tu"       || day == " Tu"      || day == "Tu "    ||
            day == "Tuesday"  || day == " Tuesday" || day == "Tuesday ")
            bits |= 0x02;

        // Wednesday
        if (day == "Wed"      || day == " Wed"     || day == "Wed "   ||
            day == "Wednesday"|| day == " Wednesday"|| day == "Wednesday ")
            bits |= 0x04;

        // Thursday
        if (day == "Thu"      || day == " Thu"     || day == "Thu "   ||
            day == "Thur"     || day == " Thur"    || day == "Thur "  ||
            day == "Thurs"    || day == " Thurs"   || day == "Thurs " ||
            day == "Th"       || day == " Th"      || day == "Th "    ||
            day == "Thursday" || day == " Thursday"|| day == "Thursday ")
            bits |= 0x08;

        // Friday
        if (day == "Fri"      || day == " Fri"     || day == "Fri "   ||
            day == "Friday"   || day == " Friday"  || day == "Friday ")
            bits |= 0x10;

        // Saturday
        if (day == "Sat"      || day == " Sat"     || day == "Sat "   ||
            day == "Saturday" || day == " Saturday"|| day == "Saturday ")
            bits |= 0x20;

        // Sunday
        if (day == "Sun"      || day == " Sun"     || day == "Sun "   ||
            day == "Sunday"   || day == " Sunday"  || day == "Sunday ")
            bits |= 0x40;
    }
    return bits;
}

// Add this method if it's not already there:

int Section::get_num_registered_students() const {
    return num_registered;  // Using your existing field name
}

// Add any other missing implementations from your section.cpp file here