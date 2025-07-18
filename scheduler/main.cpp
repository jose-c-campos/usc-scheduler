#include "scheduler.h"
#include "user_preferences.h"
#include <iostream>
#include <memory>
#include <vector>
#include <string>
#include <sstream>
#include <iomanip> // For std::setprecision

// Function to split a string by delimiter, with additional safety
std::vector<std::string> split(const std::string& str, char delimiter) {
    std::vector<std::string> tokens;
    if (str.empty()) {
        std::cerr << "WARNING: split called with empty string" << std::endl;
        return tokens;
    }
    try {
        std::string token;
        std::istringstream tokenStream(str);
        while (std::getline(tokenStream, token, delimiter)) {
            tokens.push_back(token);
        }
    } catch (const std::exception& e) {
        std::cerr << "ERROR in split function: " << e.what() << std::endl;
    }
    return tokens;
}

std::string safe_string(const char* str) {
    if (!str) {
        std::cerr << "WARNING: safe_string called with NULL pointer" << std::endl;
        return std::string("");
    }
    try {
        return std::string(str);
    } catch (const std::exception& e) {
        std::cerr << "ERROR in safe_string: " << e.what() << std::endl;
        return std::string("");
    }
}

std::string safe_string_trim(const char* str) {
    if (!str) return std::string("");
    std::string result(str);
    result.erase(result.begin(), std::find_if(result.begin(), result.end(), [](unsigned char ch) {
        return !std::isspace(ch);
    }));
    result.erase(std::find_if(result.rbegin(), result.rend(), [](unsigned char ch) {
        return !std::isspace(ch);
    }).base(), result.end());
    return result;
}

void parse_args(int argc, char* argv[], 
                std::vector<std::vector<std::string>>& class_spots,
                UserPreferences& prefs,
                bool& output_json,
                std::string& db_name,
                std::string& db_user,
                std::string& db_password,
                std::string& db_host,
                int& db_port,
                std::string& semester) {
    for (int i = 1; i < argc; i++) {
        if (!argv[i]) continue;
        std::string arg = safe_string(argv[i]);
        if (arg == "--class-spots") {
            if (i + 1 >= argc || !argv[i+1]) continue;
            std::string spots_str = safe_string(argv[++i]);
            if (!spots_str.empty()) {
                try {
                    auto spot_groups = split(spots_str, '|');
                    for (const auto& group : spot_groups) {
                        std::vector<std::string> spot;
                        if (group != "NONE") {
                            spot = split(group, ',');
                            for (auto& class_code : spot) {
                                class_code.erase(class_code.begin(), std::find_if(class_code.begin(), class_code.end(), [](unsigned char ch) {
                                    return !std::isspace(ch);
                                }));
                                class_code.erase(std::find_if(class_code.rbegin(), class_code.rend(), [](unsigned char ch) {
                                    return !std::isspace(ch);
                                }).base(), class_code.end());
                            }
                        }
                        class_spots.push_back(spot);
                    }
                } catch (...) {}
            }
        }
        else if (arg == "--preferences") {
            if (i + 1 >= argc || !argv[i+1]) continue;
            std::string prefs_str = safe_string(argv[++i]);
            try {
                auto pref_parts = split(prefs_str, '|');
                std::vector<std::string> safe_parts;
                for (size_t i = 0; i < pref_parts.size(); i++) {
                    safe_parts.push_back(pref_parts[i]);
                }
                while (safe_parts.size() < 6) {
                    safe_parts.push_back("");
                }
                if (safe_parts[0] == "morning") {
                    prefs.set_time_of_day_preference("morning");
                } else if (safe_parts[0] == "afternoon") {
                    prefs.set_time_of_day_preference("afternoon");
                } else {
                    prefs.set_time_of_day_preference("no-preference");
                }
                std::vector<std::string> empty_days;
                prefs.set_days_off(empty_days);
                if (!safe_parts[1].empty() && safe_parts[1] != "none") {
                    try {
                        auto days_off = split(safe_parts[1], ',');
                        if (!days_off.empty()) {
                            prefs.set_days_off(days_off);
                        }
                    } catch (...) {}
                }
                if (safe_parts[2] == "shorter") {
                    prefs.set_lecture_length_preference("shorter");
                } else if (safe_parts[2] == "longer") {
                    prefs.set_lecture_length_preference("longer");
                } else {
                    prefs.set_lecture_length_preference("no-preference");
                }
                prefs.set_avoid_labs(safe_parts[3] == "1");
                prefs.set_avoid_discussions(safe_parts[4] == "1");
                prefs.set_exclude_full_sections(safe_parts[5] == "1");
            } catch (...) {}
        }
        else if (arg == "--json") {
            output_json = true;
        }
        else if (arg == "--db-name") {
            if (i + 1 < argc && argv[i+1]) db_name = safe_string(argv[++i]);
        }
        else if (arg == "--db-user") {
            if (i + 1 < argc && argv[i+1]) db_user = safe_string(argv[++i]);
        }
        else if (arg == "--db-password") {
            if (i + 1 < argc && argv[i+1]) db_password = safe_string(argv[++i]);
        }
        else if (arg == "--db-host") {
            if (i + 1 < argc && argv[i+1]) db_host = safe_string(argv[++i]);
        }
        else if (arg == "--db-port") {
            if (i + 1 < argc && argv[i+1]) {
                try {
                    std::string port_str = safe_string(argv[++i]);
                    if (!port_str.empty()) db_port = std::stoi(port_str);
                } catch (...) {}
            }
        }
        else if (arg == "--semester") {
            if (i + 1 < argc && argv[i+1]) semester = safe_string(argv[++i]);
        }
    }
}

std::string join_strings(const std::vector<std::string>& strings, const std::string& delimiter) {
    std::string result;
    for (size_t i = 0; i < strings.size(); ++i) {
        result += strings[i];
        if (i < strings.size() - 1) {
            result += delimiter;
        }
    }
    return result;
}

std::string escape_json_string(const std::string& input) {
    std::string output;
    for (char c : input) {
        switch (c) {
            case '\"': output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\b': output += "\\b"; break;
            case '\f': output += "\\f"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if (c < ' ') {
                    char hex[7];
                    snprintf(hex, 7, "\\u%04x", c);
                    output += hex;
                } else {
                    output += c;
                }
        }
    }
    return output;
}

void output_schedules_as_json(const std::vector<std::pair<Schedule, double>>& schedules_with_scores, 
                             const std::shared_ptr<DatabaseConnection>& db) {
    std::cout << "{\"schedules\":[";
    for (size_t i = 0; i < schedules_with_scores.size(); i++) {
        const auto& [schedule, score] = schedules_with_scores[i];
        double total_quality = 0.0;
        double total_difficulty = 0.0;
        int prof_count = 0;
        for (const auto& item : schedule) {
            for (const auto& section : item.sections) {
                if (section.get_section_type() == "Lecture" && !section.get_instructor().empty()) {
                    auto ratings = db->get_professor_ratings(section.get_instructor(), item.class_code);
                    if (ratings.quality > 0) {
                        total_quality += ratings.quality;
                        total_difficulty += ratings.difficulty;
                        prof_count++;
                    }
                }
            }
        }
        double avg_quality = (prof_count > 0) ? (total_quality / prof_count) : 0;
        double avg_difficulty = (prof_count > 0) ? (total_difficulty / prof_count) : 0;
        double scaled_score = (score / 100.0) * 10.0;
        scaled_score = std::min(10.0, scaled_score);
        std::cout << "{\"id\":" << (i + 1) 
                  << ",\"score\":" << std::fixed << std::setprecision(1) << scaled_score
                  << ",\"avgProfRating\":" << std::fixed << std::setprecision(2) << avg_quality
                  << ",\"avgDifficulty\":" << std::fixed << std::setprecision(2) << avg_difficulty
                  << ",\"classes\":[";
        const auto& sched_data = schedule;
        std::map<std::string, std::vector<Section>> classes;
        for (const auto& item : sched_data) {
            for (const auto& section : item.sections) {
                classes[item.class_code].push_back(section);
            }
        }
        bool first_class = true;
        for (const auto& [class_code, sections] : classes) {
            if (!first_class) std::cout << ",";
            first_class = false;
            std::cout << "{\"code\":\"" << class_code << "\",\"sections\":[";
            for (size_t j = 0; j < sections.size(); j++) {
                const auto& section = sections[j];
                std::string instructor = section.get_instructor();
                if (instructor.size() > 2 && instructor.front() == '{' && instructor.back() == '}') {
                    instructor = instructor.substr(1, instructor.size() - 2);
                    if (instructor.size() > 2 && instructor.front() == '"' && instructor.back() == '"') {
                        instructor = instructor.substr(1, instructor.size() - 2);
                    }
                    instructor.erase(std::remove(instructor.begin(), instructor.end(), '\\'), instructor.end());
                }
                if (instructor.empty() || instructor == "{}" || instructor == "\"{}\"") {
                    instructor = "";
                }
                std::string formattedDays = join_strings(section.get_meeting_days(), ", ");
                if (formattedDays.empty()) formattedDays = "TBA";
                std::string timeDisplay;
                if (section.get_start_time().empty() || section.get_end_time().empty()) {
                    timeDisplay = "TBA";
                } else {
                    timeDisplay = section.get_start_time() + "-" + section.get_end_time();
                }
                std::cout << "{\"type\":\"" << section.get_section_type() << "\","
                          << "\"days\":\"" << escape_json_string(formattedDays) << "\","
                          << "\"time\":\"" << escape_json_string(timeDisplay) << "\","
                          << "\"instructor\":\"" << escape_json_string(instructor) << "\","
                          << "\"section_number\":\"" << section.get_section_number() << "\","
                          << "\"location\":\"TBA\","
                          << "\"seats_registered\":" << section.get_num_registered() << ","
                          << "\"seats_total\":" << section.get_num_seats() << ",";
                std::cout << "\"ratings\":";
                try {
                    std::string prof_name = section.get_instructor();
                    if (!prof_name.empty()) {
                        auto ratings = db->get_professor_ratings(prof_name, class_code);
                        std::cout << "{\"quality\":" << ratings.quality << ","
                                  << "\"difficulty\":" << ratings.difficulty << ","
                                  << "\"would_take_again\":" << ratings.would_take_again << ","
                                  << "\"course_quality\":"    << ratings.course_specific_quality   << ',' 
                                  << "\"course_difficulty\":" << ratings.course_specific_difficulty 
                                  << "}";
                    } else {
                        std::cout << "{\"quality\":0,\"difficulty\":0,\"would_take_again\":0}";
                    }
                } catch (...) {
                    std::cout << "{\"quality\":0,\"difficulty\":0,\"would_take_again\":0}";
                }
                std::cout << "}";
                if (j < sections.size() - 1) std::cout << ",";
            }
            std::cout << "]}";
        }
        std::cout << "]}";
        if (i < schedules_with_scores.size() - 1) std::cout << ",";
    }
    std::cout << "]}";
}

int main(int argc, char* argv[]) {
    bool output_json = false;
    try {
        std::vector<std::vector<std::string>> class_spots;
        UserPreferences prefs;
        std::string db_name = "usc_sched";
        std::string db_user = "REDACTED";
        std::string db_password = "REDACTED";
        std::string db_host = "localhost";
        int db_port = 5432;
        std::string semester = "20253";
        try {
            const char* db_name_env = std::getenv("USC_DB_NAME");
            if (db_name_env && *db_name_env) db_name = db_name_env;
            const char* db_user_env = std::getenv("USC_DB_USER");
            if (db_user_env && *db_user_env) db_user = db_user_env;
            const char* db_password_env = std::getenv("USC_DB_PASSWORD");
            if (db_password_env && *db_password_env) db_password = db_password_env;
            const char* db_host_env = std::getenv("USC_DB_HOST");
            if (db_host_env && *db_host_env) db_host = db_host_env;
            const char* db_port_env = std::getenv("USC_DB_PORT");
            if (db_port_env && *db_port_env) {
                try { db_port = std::stoi(db_port_env); } catch (...) {}
            }
        } catch (...) {}
        parse_args(argc, argv, class_spots, prefs, output_json, db_name, db_user, db_password, db_host, db_port, semester);
        if (class_spots.empty()) {
            class_spots = {
                {"CSCI 103", "CSCI 104"},
                {"WRIT 150"},
                {"BISC 120", "MATH 126"},
                {"CSCI 170"}
            };
        }
        std::shared_ptr<DatabaseConnection> db;
        try {
            if (db_name.empty()) db_name = "usc_sched";
            if (db_user.empty()) db_user = "REDACTED";
            if (db_password.empty()) db_password = "REDACTED";
            if (db_host.empty()) db_host = "localhost";
            if (semester.empty()) semester = "20253";
            db = std::make_shared<DatabaseConnection>(
                db_name, db_user, db_password, db_host, db_port, semester
            );
        } catch (...) { throw; }
        Scheduler scheduler(db, output_json);
        auto schedules_with_scores = scheduler.build_schedule(class_spots, prefs, 10, output_json);
        if (output_json) {
            output_schedules_as_json(schedules_with_scores, db);
        } else {
            std::cout << "\nFound " << schedules_with_scores.size() << " optimal schedules:\n";
            for (size_t i = 0; i < schedules_with_scores.size(); i++) {
                std::cout << "\nSchedule #" << (i + 1) << ":\n";
                scheduler.print_schedule(schedules_with_scores[i].first, true);
            }
        }
        return 0;
    }
    catch (const std::exception& e) {
        if (output_json) {
            std::cout << "{\"error\":\"" << escape_json_string(e.what()) << "\"}" << std::endl;
        }
        return 1;
    }
    catch (...) {
        if (output_json) {
            std::cout << "{\"error\":\"Unknown fatal error occurred\"}" << std::endl;
        }
        return 1;
    }
}