const Hero = () => {
  return (
    <section className="w-full px-8 sm:px-16 py-16 md:py-24 flex flex-col md:flex-row md:items-center gap-12">
      {/* Left Column - Title and Author - with text-center and padding adjustments */}
      <div className="md:w-1/2 text-center md:text-left md:pl-12 lg:pl-16">
        <h1 className="text-white text-4xl sm:text-6xl font-bold mb-4">USC Scheduler</h1>
        <h3 className="text-white text-lg sm:text-2xl font-medium mb-6">By Jose Campos</h3>
        <button 
          className="bg-white text-usc-red font-bold py-3 px-8 rounded-lg hover:bg-white/90 transition-colors"
          onClick={() => document.querySelector('button[data-section="scheduler"]')?.click()}
        >
          Start Planning
        </button>
      </div>
      
      {/* Right Column - Feature List (unchanged) */}
      <div className="md:w-1/2">
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-8">
          <h2 className="text-white text-2xl font-semibold mb-6">What USC Scheduler Can Do</h2>
          
          <ul className="space-y-6">
            <li className="flex items-start">
              <div className="bg-white text-usc-red rounded-full p-1 mr-4 mt-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg">Lightning Fast Generation</h3>
                <p className="text-white/80">Processes over 45,000 schedule combinations per second, evaluating millions of possibilities in moments.</p>
              </div>
            </li>
            
            <li className="flex items-start">
              <div className="bg-white text-usc-red rounded-full p-1 mr-4 mt-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg">Smart Preferences</h3>
                <p className="text-white/80">Customize your perfect schedule with preferences for time of day, days off, class length, and section types.</p>
              </div>
            </li>
            
            <li className="flex items-start">
              <div className="bg-white text-usc-red rounded-full p-1 mr-4 mt-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg">Professor Insights</h3>
                <p className="text-white/80">View detailed professor ratings for each schedule, helping you choose classes with the best instructors.</p>
              </div>
            </li>
            
            <li className="flex items-start">
              <div className="bg-white text-usc-red rounded-full p-1 mr-4 mt-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg">Conflict-Free Planning</h3>
                <p className="text-white/80">Automatically eliminates schedules with time conflicts, ensuring you get viable options every time.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

export default Hero