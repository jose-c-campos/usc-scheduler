import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './sections/Hero'
import Scheduler from './sections/Scheduler'
import HowToUse from "./sections/HowToUse";
import Auth from "./sections/Auth";
import Profile from "./sections/Profile";
import HelmetCanvas from './components/HelmetCanvas';
import Landing from './sections/Landing';
import TestAPI from './components/TestAPI';
import './index.css'

function App() {
  const [activeSection, setActiveSection] = useState('hero')

  return (
    <main className="bg-dark-bg min-h-screen">
      <Router>
        <Navbar activeSection={activeSection} setActiveSection={setActiveSection}/>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/scheduler" element={<Scheduler />} />
          <Route path="/howto" element={<HowToUse />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/test" element={<TestAPI />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </main>
  )
}

export default App
