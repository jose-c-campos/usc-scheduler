import schedule from "../assets/schedule.svg";
import algorithm from "../assets/algorithm.svg";
import preference from "../assets/preference.svg";
import speed from "../assets/speed.svg";
import data from "../assets/data.svg";

export const howToUseData = [
	{
		id: 1,
		title: "Create and Compare Class Schedules",
		desc: "Easily compare millions of possible class and section combinations. View schedules side by side, including professor info, which is hard to find on the official registration site.",
		thumbnail: schedule,
		bullets: [
			"See all your options at once",
			"Compare professors and times easily",
			"No more switching between sites",
		],
	},
	{
		id: 2,
		title: "Smart Ranking Algorithm",
		desc: "Our algorithm uses professor ratings and reviews from RateMyProfessor, plus your preferences, to find and rank the best schedules for you.",
		thumbnail: algorithm,
		bullets: [
			"Professor quality matters in your results",
			"Customizable ranking with your preferences",
			"Transparent and unbiased scoring",
		],
	},
	{
		id: 3,
		title: "Personalize with Preferences",
		desc: "Customize your search by telling us what matters most—like time of day, days off, or avoiding labs. Your preferences help us score and sort schedules for you.",
		thumbnail: preference,
		bullets: [
			"Choose your ideal days and times",
			"Avoid labs or discussions if you want",
			"Get schedules that fit your lifestyle",
		],
	},
	{
		id: 4,
		title: "Fast Results",
		desc: "USC Scheduler can generate and rank tens of thousands of schedules per second. For faster results, enter your preferred classes and sections.",
		thumbnail: speed,
		bullets: [
			"Handles millions of combinations",
			"Optimized for speed and accuracy",
			"More choices may take longer to process",
		],
	},
	{
		id: 5,
		title: "Data Accuracy",
		desc: "We update class data nightly from the USC registration site. Seat counts may not always be current. Use USC Scheduler for planning, and confirm details before registering.",
		thumbnail: data,
		bullets: [
			"Class info updated every night",
			"Seat counts may lag behind real-time",
			"Always double-check before registering",
		],
	},
];