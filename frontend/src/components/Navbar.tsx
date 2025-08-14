import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface NavbarProps {
  activeSection: string;
  setActiveSection: (section: string) => void;
}

const Navbar = ({ activeSection, setActiveSection }: NavbarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, user, logout } = useAuth();
  
  // Define nav links based on authentication status
  const navLinks = [
    { label: "Home", section: "hero", path: "/" },
    ...(isAuthenticated 
      ? [{ label: "My Profile", section: "profile", path: "/profile" }]
      : [{ label: "Login/Signup", section: "login", path: "/login" }]
    ),
    { label: "Contact", section: "contact", path: "/contact" },
  ];
  
    React.useEffect(() => {
    if (location.pathname === "/scheduler") {
      setActiveSection("scheduler");
      return;
    }

    const matched = navLinks.find(l => l.path === location.pathname)?.section;
    if (matched) {
      setActiveSection(matched);
    }
  }, [location.pathname, setActiveSection]);

  // Helper so we can style the CTA button consistently
  const schedulerIsActive = activeSection === "scheduler";

  return (
    <header className="w-full pt-8 px-5 flex items-center justify-between">
      {/* --- Brand / title ------------------------------------------------- */}
      <div className="flex items-center">
        <span className="text-3xl ml-8 font-bold text-usc-red tracking-tight">
          USC Scheduler
        </span>
      </div>

      {/* --- Nav links + CTA ---------------------------------------------- */}
      <nav className="flex gap-8 items-center mr-8">
        {navLinks.map(link => (
          <Link
            key={link.section}
            to={link.path}
            className={`
              text-base sm:text-lg transition-all duration-200
              ${activeSection === link.section
                ? "text-usc-red underline underline-offset-8"
                : "text-white"}
              hover:text-usc-red
            `}
            onClick={() => setActiveSection(link.section)}
          >
            {link.label}
          </Link>
        ))}

        {/* Show logout button if authenticated */}
        {isAuthenticated && (
          <button
            onClick={() => {
              logout();
              navigate("/");
              setActiveSection("hero");
            }}
            className="text-white hover:text-usc-red text-sm"
          >
            Logout
          </button>
        )}

        {/* Scheduler CTA button – highlights when on /scheduler */}
        <button
          className={`
            px-5 py-2 rounded-full font-bold transition-colors text-base sm:text-lg
            ${schedulerIsActive
              ? "bg-white text-usc-red"      /* highlighted */
              : "bg-usc-red text-black hover:bg-red-800" /* normal */}
          `}
          onClick={() => {
            navigate("/scheduler");
            setActiveSection("scheduler");
          }}
        >
          Schedule
        </button>
      </nav>
    </header>
  );
};

export default Navbar;
