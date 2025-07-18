import React from "react";
import { howToUseData } from "../data/howToUse";

const HowToUse = () => (
  <div className="py-16 w-full bg-dark-bg min-h-screen">
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-20">
      {howToUseData.map((card) => (
        <div
          key={card.id}
          className="flex flex-col md:flex-row items-center gap-10"
        >
          <img
            src={card.thumbnail}
            alt={card.title}
            className="w-40 h-40 md:w-56 md:h-56 object-contain flex-shrink-0"
          />
          <div className="flex-1">
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">{card.title}</h2>
            <p className="text-lg md:text-xl text-white/90 mb-4">{card.desc}</p>
            <ul className="list-disc pl-6 space-y-2 text-lg text-white/80">
              {card.bullets && card.bullets.slice(0, 3).map((point, idx) => (
                <li key={idx}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default HowToUse;