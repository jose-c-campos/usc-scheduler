#include "user_preferences.h"

UserPreferences::UserPreferences()
    : time_of_day_preference_(0),
      lecture_length_preference_(0),
      avoid_labs_(false),
      avoid_discussions_(false),
      exclude_full_sections_(true) { // Default to true
}

void UserPreferences::set_days_off(const std::vector<std::string>& days) {
    days_off_ = days;
}

void UserPreferences::set_avoid_labs(bool avoid) {
    avoid_labs_ = avoid;
}

void UserPreferences::set_avoid_discussions(bool avoid) {
    avoid_discussions_ = avoid;
}

void UserPreferences::set_time_of_day_preference(const std::string& pref) {
    if (pref == "morning") {
        time_of_day_preference_ = -1;
    } else if (pref == "afternoon") {
        time_of_day_preference_ = 1;
    } else {
        time_of_day_preference_ = 0;
    }
}

void UserPreferences::set_lecture_length_preference(const std::string& pref) {
    if (pref == "shorter") {
        lecture_length_preference_ = -1;
    } else if (pref == "longer") {
        lecture_length_preference_ = 1;
    } else {
        lecture_length_preference_ = 0;
    }
}

void UserPreferences::set_exclude_full_sections(bool exclude) {
    exclude_full_sections_ = exclude;
}

bool UserPreferences::get_exclude_full_sections() const {
    return exclude_full_sections_;
}

std::vector<std::string> UserPreferences::get_days_off() const {
    return days_off_;
}

bool UserPreferences::get_avoid_labs() const {
    return avoid_labs_;
}

bool UserPreferences::get_avoid_discussions() const {
    return avoid_discussions_;
}

int UserPreferences::get_time_of_day_preference() const {
    return time_of_day_preference_;
}

int UserPreferences::get_lecture_length_preference() const {
    return lecture_length_preference_;
}