// #pragma once
// #include <string>
// #include <vector>
// #include <map>

// class UserPreferences {
// public:
//     // Constructors
//     UserPreferences();
//     UserPreferences(const std::map<std::string, double>& pref_map, 
//                    const std::vector<std::string>& days_off = {});
    
//     // Morning vs. Afternoon preference
//     // -1 = prefer morning, 0 = no preference, 1 = prefer afternoon
//     void set_time_of_day_preference(int preference);
//     int get_time_of_day_preference() const;
    
//     // Days off preference (max 4)
//     void set_days_off(const std::vector<std::string>& days);
//     std::vector<std::string> get_days_off() const;
    
//     // Lecture length preference
//     // -1 = prefer shorter, 0 = no preference, 1 = prefer longer
//     void set_lecture_length_preference(int preference);
//     int get_lecture_length_preference() const;
    
//     // Lab and discussion preferences (0 = no preference, 1 = avoid)
//     void set_avoid_labs(bool avoid);
//     bool get_avoid_labs() const;
    
//     void set_avoid_discussions(bool avoid);
//     bool get_avoid_discussions() const;
    
//     // Get all preferences as a map
//     std::map<std::string, double> to_map() const;
    
// private:
//     int time_of_day_preference;         // -1, 0, 1
//     std::vector<std::string> days_off;  // e.g., ["Mon", "Fri"]
//     int lecture_length_preference;      // -1, 0, 1
//     bool avoid_labs;                    // true/false
//     bool avoid_discussions;             // true/false
// };

#pragma once
#include <vector>
#include <string>

class UserPreferences {
public:
    // Constructor
    UserPreferences();
    
    // Preference setters
    void set_time_of_day_preference(const std::string& pref);
    void set_days_off(const std::vector<std::string>& days);
    void set_lecture_length_preference(const std::string& pref);
    void set_avoid_labs(bool avoid);
    void set_avoid_discussions(bool avoid);
    void set_exclude_full_sections(bool exclude); // New setter
    
    // Preference getters
    int get_time_of_day_preference() const;
    std::vector<std::string> get_days_off() const;
    int get_lecture_length_preference() const;
    bool get_avoid_labs() const;
    bool get_avoid_discussions() const;
    bool get_exclude_full_sections() const; // New getter
    
private:
    int time_of_day_preference_; // -1 for morning, 0 for no preference, 1 for afternoon
    std::vector<std::string> days_off_;
    int lecture_length_preference_; // -1 for shorter, 0 for no preference, 1 for longer
    bool avoid_labs_;
    bool avoid_discussions_;
    bool exclude_full_sections_{true}; // Default to true
};