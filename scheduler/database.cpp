#include "database.h"
#include <iostream>
#include <sstream>
#include <libpq-fe.h>
#include <algorithm>
#include <set>

DatabaseConnection::DatabaseConnection(std::string db_name, std::string user, 
                                      std::string password, std::string host, 
                                      int port, std::string semester)
    : db_name_(db_name), user_(user), password_(password), 
      host_(host), port_(port), semester_(semester) {
    // Construct connection string
    std::stringstream conninfo;
    conninfo << "dbname=" << db_name_
             << " user=" << user_
             << " password=" << password_
             << " host=" << host_
             << " port=" << port_;
    
    // Establish connection
    conn = PQconnectdb(conninfo.str().c_str());
    
    // Check connection status
    if (PQstatus(conn) != CONNECTION_OK) {
        std::cerr << "Connection to database failed: " 
                  << PQerrorMessage(conn) << std::endl;
        PQfinish(conn);
        conn = nullptr;
    }
}

DatabaseConnection::~DatabaseConnection() {
    if (conn) {
        PQfinish(conn);
        conn = nullptr;
    }
}

void DatabaseConnection::check_connection() const {
    if (!conn || PQstatus(conn) != CONNECTION_OK) {
        throw std::runtime_error("Database connection is not available");
    }
}

std::string DatabaseConnection::get_last_error() const {
    if (!conn) {
        return "No database connection";
    }
    return PQerrorMessage(conn);
}

bool DatabaseConnection::execute_query(const std::string& query, 
                                     const std::vector<std::string>& params) {
    check_connection();
    
    // Convert parameters to C-style array
    std::vector<const char*> c_params;
    for (const auto& param : params) {
        c_params.push_back(param.c_str());
    }
    
    // Execute query
    PGresult* result = PQexecParams(
        conn,
        query.c_str(),
        static_cast<int>(params.size()),
        nullptr,  // Use default parameter types (text)
        c_params.data(),  // This is now const char* const*
        nullptr,  // All parameters in text format
        nullptr,  // All results in text format
        0         // No binary results
    );
    
    // Check result
    if (PQresultStatus(result) != PGRES_TUPLES_OK && 
        PQresultStatus(result) != PGRES_COMMAND_OK) {
        std::cerr << "Query execution failed: " << PQerrorMessage(conn) << std::endl;
        PQclear(result);
        return false;
    }
    
    PQclear(result);
    return true;
}

std::vector<Section> DatabaseConnection::query_sections_from_db(const std::string& class_code) {
    std::vector<Section> sections;
    
    check_connection();
    
    const char* query = "SELECT s.type, s.days_of_week, s.start_time, s.end_time, "
                       "s.location, s.num_students_enrolled, s.num_seats, "
                       "s.instructors, s.section_number, p.section_number as parent_section_number "
                       "FROM sections s "
                       "LEFT JOIN sections p ON s.parent_section_id = p.id "
                       "JOIN courses c ON s.course_id = c.id "
                       "WHERE c.code = $1 AND c.semester = $2";
    
    std::vector<std::string> params = {class_code, semester_};
    
    // Convert std::string params to C-style char* array
    std::vector<const char*> c_params;
    for (const auto& param : params) {
        c_params.push_back(param.c_str());
    }
    
    PGresult* result = PQexecParams(
        conn, 
        query, 
        2,  // two parameters
        nullptr, 
        c_params.data(),  // Use c_params.data() instead of params.data()
        nullptr, 
        nullptr, 
        0
    );
    
    if (PQresultStatus(result) != PGRES_TUPLES_OK) {
        std::cerr << "Failed to get sections: " << PQerrorMessage(conn) << std::endl;
        PQclear(result);
        return sections;
    }
    
    // Process results
    int rows = PQntuples(result);
    for (int i = 0; i < rows; i++) {
        // Extract fields
        std::string section_type = PQgetvalue(result, i, 0);
        std::string meeting_days_str = PQgetvalue(result, i, 1);
        std::string start_time = PQgetvalue(result, i, 2);
        std::string end_time = PQgetvalue(result, i, 3);
        std::string location = PQgetvalue(result, i, 4);
        int registered = std::stoi(PQgetvalue(result, i, 5));
        int seats = std::stoi(PQgetvalue(result, i, 6));
        std::string instructor = PQgetvalue(result, i, 7);
        std::string section_number = PQgetvalue(result, i, 8);
        std::string parent_section_number = PQgetisnull(result, i, 9) ? 
            "" : PQgetvalue(result, i, 9);
        
        // Parse meeting days
        std::vector<std::string> meeting_days;
        std::istringstream iss(meeting_days_str);
        std::string day;
        while (iss >> day) {
            meeting_days.push_back(day);
        }
        
        // Create section with parent_section_number
        sections.emplace_back(
            section_type,
            meeting_days,
            std::make_pair(start_time, end_time),
            location,
            registered,
            seats,
            instructor,
            section_number,
            parent_section_number  // Add parent section number
        );
    }
    
    PQclear(result);
    return sections;
}

std::vector<std::vector<Section>> DatabaseConnection::find_sections_for_class(
    const std::string& class_code) {
    
    std::vector<Section> all_sections = query_sections_from_db(class_code);
    std::vector<std::vector<Section>> result;
    
    // Group sections by type (lecture, lab, discussion, etc.)
    std::map<std::string, std::vector<Section>> sections_by_type;
    for (const auto& section : all_sections) {
        sections_by_type[section.get_section_type()].push_back(section);
    }
    
    // Return the sections properly grouped by type
    for (const auto& [type, type_sections] : sections_by_type) {
        result.push_back(type_sections);
    }
    
    return result;
}

DatabaseConnection::ProfessorRating DatabaseConnection::get_professor_ratings(
    const std::string& professor_name, const std::string& course_code) {
        
        ProfessorRating r{};                      // all fields start at 0
         std::string name = professor_name;    

        /* strip curls / quotes that sometimes arrive from the section record */
        name.erase(std::remove_if(name.begin(), name.end(),
                                [](char c){return c=='{'||c=='}'||c=='\"';}),
                name.end());
        if (name.empty()) return r;               // nothing to look up

        check_connection();

        /* 1️⃣  try course‑specific first  ------------------------------------ */
        {
            const char* qry = R"SQL(
            SELECT
                   COALESCE(pcr.avg_quality,0)      ,
                   COALESCE(pcr.avg_difficulty,0)   ,
                   COALESCE(p.would_take_again_percent,0),
                   COALESCE(p.avg_rating,0)         ,
                   COALESCE(p.avg_difficulty,0)
            FROM   professors            p
            JOIN   prof_course_ratings   pcr
                   ON p.id = pcr.professor_id
            /* ── canonical compare: strip every non‑alphanumeric char ── */
            WHERE  lower(regexp_replace(p.name         ,'[^A-Za-z0-9]','','g'))
                   = lower(regexp_replace($1           ,'[^A-Za-z0-9]','','g'))
              AND  lower(regexp_replace(pcr.course_code,'[^A-Za-z0-9]','','g'))
                   = lower(regexp_replace($2           ,'[^A-Za-z0-9]','','g'))
            ORDER BY pcr.num_reviews DESC
            LIMIT 1)SQL";

            std::string course = course_code;        // no % wild‑cards!
            const char* vals[2] = { name.c_str(), course.c_str() };

            PGresult* res = PQexecParams(conn, qry, 2, nullptr, vals,
                                         nullptr, nullptr, 0);

            if (PQresultStatus(res)==PGRES_TUPLES_OK && PQntuples(res)==1) {
                r.course_specific_quality    = std::stod(PQgetvalue(res,0,0));
                r.course_specific_difficulty = std::stod(PQgetvalue(res,0,1));
                r.would_take_again           = std::stod(PQgetvalue(res,0,2));
                r.quality                    = std::stod(PQgetvalue(res,0,3));
                r.difficulty                 = std::stod(PQgetvalue(res,0,4));
                PQclear(res);
                return r;                           // got the best data
            }
            PQclear(res);
        }

        /* 2️⃣  fall back to professor‑wide numbers  -------------------------- */
        {
            const char* qry =
                "SELECT avg_rating, avg_difficulty, would_take_again_percent "
                "FROM professors "
                "WHERE name ILIKE $1 "
                "LIMIT 1";
            std::string n = "%" + name + "%";
            const char* val[1] = { n.c_str() };

            PGresult* res = PQexecParams(conn, qry, 1, nullptr, val,
                                        nullptr, nullptr, 0);

            if (PQresultStatus(res)==PGRES_TUPLES_OK && PQntuples(res)==1) {
                if (!PQgetisnull(res,0,0))
                    r.quality    = std::stod(PQgetvalue(res,0,0));
                if (!PQgetisnull(res,0,1))
                    r.difficulty = std::stod(PQgetvalue(res,0,1));
                if (!PQgetisnull(res,0,2))
                    r.would_take_again = std::stod(PQgetvalue(res,0,2));
            }
            PQclear(res);
        }

        /* 3️⃣  nothing in DB → keep zeros (don’t randomise)  ---------------- */
        return r;
    
    // For debugging, output what's being queried
    // std::cerr << "Querying ratings for professor: " << professor_name 
    //           << " in course: " << course_code << std::endl;
    
    // // If professor name contains quotes or braces, clean it
    // std::string clean_name = professor_name;
    // if (!clean_name.empty() && clean_name.front() == '{' && clean_name.back() == '}') {
    //     clean_name = clean_name.substr(1, clean_name.size() - 2);
    // }
    
    // // Remove any quotes if present
    // if (!clean_name.empty() && clean_name.front() == '"' && clean_name.back() == '"') {
    //     clean_name = clean_name.substr(1, clean_name.size() - 2);
    // }
    
    // // Empty name check
    // if (clean_name.empty()) {
    //     return {0.0, 0.0, 0.0};
    // }
    
    // ProfessorRating ratings = {0.0, 0.0, 0.0}; // Default ratings
    
    // try {
    //     check_connection();
        
    //     // First try to get course-specific ratings
    //     std::string query = 
    //         "SELECT pcr.avg_quality, pcr.avg_difficulty, p.would_take_again_percent "
    //         "FROM professors p "
    //         "JOIN prof_course_ratings pcr ON p.id = pcr.professor_id "
    //         "WHERE p.name ILIKE $1 AND pcr.course_code ILIKE $2 "
    //         "ORDER BY pcr.num_reviews DESC LIMIT 1";
            
    //     // Create persistent strings to hold the query parameters
    //     std::string clean_name_param = "%" + clean_name + "%";
    //     std::string course_code_param = "%" + course_code + "%";
            
    //     const char* param_values[2] = {
    //         clean_name_param.c_str(),
    //         course_code_param.c_str()
    //     };
        
    //     PGresult* result = PQexecParams(
    //         conn, 
    //         query.c_str(), 
    //         2,  // Two parameters
    //         nullptr, 
    //         param_values,
    //         nullptr, 
    //         nullptr, 
    //         0
    //     );
        
    //     // If course-specific ratings found
    //     if (PQresultStatus(result) == PGRES_TUPLES_OK && PQntuples(result) > 0) {
    //         // Get course-specific ratings
    //         if (!PQgetisnull(result, 0, 0))
    //             ratings.quality = std::stod(PQgetvalue(result, 0, 0));
            
    //         if (!PQgetisnull(result, 0, 1))
    //             ratings.difficulty = std::stod(PQgetvalue(result, 0, 1));
            
    //         if (!PQgetisnull(result, 0, 2))
    //             ratings.would_take_again = std::stod(PQgetvalue(result, 0, 2));
                
    //         PQclear(result);
    //         return ratings;
    //     }
        
    //     PQclear(result);
        
    //     // If no course-specific ratings, get overall professor ratings
    //     query = 
    //         "SELECT avg_rating, avg_difficulty, would_take_again_percent "
    //         "FROM professors "
    //         "WHERE name ILIKE $1 "
    //         "LIMIT 1";
            
    //     // Create a persistent string for this parameter too
    //     std::string prof_name_param = "%" + clean_name + "%";

    //     const char* prof_param_values[1] = {
    //         prof_name_param.c_str()
    //     };
        
    //     result = PQexecParams(
    //         conn, 
    //         query.c_str(), 
    //         1,  // One parameter
    //         nullptr, 
    //         prof_param_values,
    //         nullptr, 
    //         nullptr, 
    //         0
    //     );
        
    //     if (PQresultStatus(result) == PGRES_TUPLES_OK && PQntuples(result) > 0) {
    //         // Get overall ratings
    //         if (!PQgetisnull(result, 0, 0))
    //             ratings.quality = std::stod(PQgetvalue(result, 0, 0));
            
    //         if (!PQgetisnull(result, 0, 1))
    //             ratings.difficulty = std::stod(PQgetvalue(result, 0, 1));
            
    //         if (!PQgetisnull(result, 0, 2))
    //             ratings.would_take_again = std::stod(PQgetvalue(result, 0, 2));
    //     }
        
    //     PQclear(result);
        
    //     // If all values are still 0.0, use default fallback ratings
    //     if (ratings.quality == 0.0 && ratings.difficulty == 0.0 && ratings.would_take_again == 0.0) {
    //         // Fall back to mock data for well-known professors
    //         if (clean_name.find("Cameron Egan") != std::string::npos) {
    //             return {4.5, 2.8, 95.0};
    //         } else if (clean_name.find("Andrew Goodney") != std::string::npos) {
    //             return {4.2, 3.1, 88.0};
    //         } else if (clean_name.find("Jesus Fuentes") != std::string::npos) {
    //             return {3.8, 3.0, 75.0};
    //         } else {
    //             // For all other professors, return slightly random but reasonable ratings
    //             return {3.5 + (std::rand() % 10) / 10.0, 
    //                     2.8 + (std::rand() % 14) / 10.0, 
    //                     70.0 + std::rand() % 20};
    //         }
    //     }
    // }
    // catch (const std::exception& e) {
    //     std::cerr << "Error querying professor ratings: " << e.what() << std::endl;
    //     // Fall back to mock data
    //     if (clean_name.find("Cameron Egan") != std::string::npos) {
    //         return {4.5, 2.8, 95.0};
    //     } else if (clean_name.find("Andrew Goodney") != std::string::npos) {
    //         return {4.2, 3.1, 88.0};
    //     } else if (clean_name.find("Jesus Fuentes") != std::string::npos) {
    //         return {3.8, 3.0, 75.0};
    //     }
    // }
    
    // return ratings;
}

DatabaseConnection::AllSpots DatabaseConnection::find_class_spots(
    const std::vector<std::vector<std::string>>& class_codes) {
    
    AllSpots result;
    
    for (const auto& spot : class_codes) {
        std::vector<SpotOption> spot_options;
        
        for (const auto& class_code : spot) {
            SpotOption option;
            auto sections = find_sections_for_class(class_code);
            
            // Skip if no sections found
            if (sections.empty()) {
                continue;
            }
            
            // Process the sections into packages
            ClassOptions packages;
            
            // For simplicity, we'll treat each section as its own package
            // In a real implementation, you'd need to combine sections properly
            for (const auto& section_group : sections) {
                for (const auto& section : section_group) {
                    packages.push_back({section});
                }
            }
            
            option[class_code] = packages;
            spot_options.push_back(option);
        }
        
        result.push_back(spot_options);
    }
    
    return result;
}

std::set<std::string> DatabaseConnection::get_required_section_types(const std::string& class_code) const {
    std::set<std::string> required_types;
    check_connection();

    // Query all unique section types for this course in the current semester
    std::string query =
        "SELECT DISTINCT type FROM sections s "
        "JOIN courses c ON s.course_id = c.id "
        "WHERE c.code = $1 AND c.semester = $2";

    std::vector<std::string> params = {class_code, semester_};
    std::vector<const char*> c_params;
    for (const auto& param : params) c_params.push_back(param.c_str());

    PGresult* result = PQexecParams(
        conn,
        query.c_str(),
        2,
        nullptr,
        c_params.data(),
        nullptr,
        nullptr,
        0
    );

    if (PQresultStatus(result) == PGRES_TUPLES_OK) {
        int rows = PQntuples(result);
        for (int i = 0; i < rows; ++i) {
            std::string type = PQgetvalue(result, i, 0);
            if (!type.empty())
                required_types.insert(type);
        }
    }
    PQclear(result);

    // Fallback: always require at least "Lecture" if nothing found
    if (required_types.empty()) required_types.insert("Lecture");
    return required_types;
}