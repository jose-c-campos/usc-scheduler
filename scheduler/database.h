#pragma once
#include <vector>
#include <string>
#include <map>
#include <memory>
#include <set>
#include "section.h"

// Forward declaration for PGconn from libpq
typedef struct pg_conn PGconn;

class DatabaseConnection {
public:
    DatabaseConnection(std::string db_name, std::string user, std::string password, 
                       std::string host, int port, std::string semester = "");
    ~DatabaseConnection();
    
    // Disable copy to prevent issues with connection ownership
    DatabaseConnection(const DatabaseConnection&) = delete;
    DatabaseConnection& operator=(const DatabaseConnection&) = delete;
    
    // Core database functionality
    std::vector<std::vector<Section>> find_sections_for_class(const std::string& class_code);
    
    // Professor ratings
    struct ProfessorRating {
        double quality = 0.0;
        double difficulty = 0.0;
        double would_take_again = 0.0;
        double course_specific_quality = 0.0;
        double course_specific_difficulty = 0.0;
    };
    
    ProfessorRating get_professor_ratings(const std::string& professor_name, 
                                         const std::string& class_code);
    
    // Schedule building
    using ClassPackage = std::vector<Section>;
    using ClassOptions = std::vector<ClassPackage>;
    using SpotOption = std::map<std::string, ClassOptions>;
    using AllSpots = std::vector<std::vector<SpotOption>>;
    
    AllSpots find_class_spots(const std::vector<std::vector<std::string>>& class_codes);

    // Getters for database connection parameters
    std::string get_db_name() const { return db_name_; }
    std::string get_user() const { return user_; }
    std::string get_password() const { return password_; }
    std::string get_host() const { return host_; }
    int get_port() const { return port_; }
    std::string get_semester() const { return semester_; }

    std::set<std::string> get_required_section_types(const std::string& class_code) const;

private:
    PGconn* conn;
    std::string semester_;
    
    // Database connection parameters
    std::string db_name_;
    std::string user_;
    std::string password_;
    std::string host_;
    int port_;
    
    // Helper methods
    std::vector<Section> query_sections_from_db(const std::string& class_code);
    bool execute_query(const std::string& query, const std::vector<std::string>& params = {});
    
    // Error handling
    void check_connection() const;
    std::string get_last_error() const;
};