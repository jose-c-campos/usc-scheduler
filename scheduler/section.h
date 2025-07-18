// section.h
#pragma once

#include <string>
#include <vector>
#include <utility>
#include <iostream>
#include <sstream>
#include <algorithm>

class Section {
public:
    // Constructor
    Section(std::string sectionType, 
            std::vector<std::string> meeting_days,
            std::pair<std::string, std::string> meeting_times,
            std::string location, 
            int num_registered, 
            int num_seats,
            std::string instructor = "",
            std::string section_number = "",
            std::string parent_section_number = ""); // Added parent_section_number
    
    // Methods - declarations only, no implementations here
    std::string get_section_type() const;
    const std::vector<std::string>& get_meeting_days() const;
    const std::pair<std::string, std::string>& get_meeting_times() const;
    std::string get_location() const;
    int get_num_registered() const;
    int get_num_seats() const;
    std::string get_instructor() const;
    std::string get_section_number() const;
    std::string to_string() const;
    bool conflicts_with(const Section& other) const;
    
    // These are the ones causing redefinition errors - remove implementations
    std::string get_parent_section_number() const; // Remove { return parent_section_number; }
    std::string get_start_time() const;  // Remove any implementation
    std::string get_end_time() const;    // Remove any implementation
    uint8_t get_day_bits() const;        // Remove any implementation
    int get_num_registered_students() const;  // Returns the number of enrolled students

private:
    std::string sectionType;
    std::vector<std::string> meeting_days;
    std::pair<std::string, std::string> meeting_times;
    std::string location;
    int num_registered;
    int num_seats;
    std::string instructor;
    std::string section_number;
    std::string parent_section_number;
};
